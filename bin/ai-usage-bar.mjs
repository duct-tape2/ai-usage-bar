#!/usr/bin/env node
// ai-usage-bar CLI

import { ensureDirs, describePaths, CONFIG_FILE } from "../src/core/paths.mjs";
import { loadConfig, saveConfig, providerEnablement, providerConfig, DEFAULT_CONFIG } from "../src/core/config.mjs";
import { loadRegistry } from "../src/core/registry.mjs";
import { runProvider } from "../src/core/runner.mjs";
import { createScheduler } from "../src/core/scheduler.mjs";
import { createServer, listen } from "../src/server/server.mjs";
import { makeAuth, loadToken, createToken } from "../src/server/auth.mjs";
import { readSnapshot } from "../src/server/store.mjs";
import { buildHealth } from "../src/server/health.mjs";
import { getPlatform } from "../src/platform/index.mjs";
import { SAFE_TIERS } from "../src/core/schema.mjs";

const argv = process.argv.slice(2);
const command = argv[0] || "help";

function flag(name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const next = argv[index + 1];
  return next && !next.startsWith("--") ? next : true;
}

function log(event, fields = {}) {
  if (process.env.AI_USAGE_BAR_QUIET === "1") return;
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Refuses to put the dashboard on a network without a read token. The
 * original single-user server bound a tailnet address and served reads to
 * anyone who could reach it; that is exactly the default this prevents.
 */
function assertExposureAllowed(host, readToken) {
  if (LOOPBACK.has(host)) return;
  if (readToken) return;
  console.error([
    `refusing to bind ${host} without a read token.`,
    "",
    "Anyone who can reach that address would see your usage. Create a token first:",
    "  ai-usage-bar token read --new",
    "",
    "Or bind loopback only:",
    "  ai-usage-bar serve --host 127.0.0.1",
  ].join("\n"));
  process.exit(2);
}

async function resolveExposeHost(mode) {
  if (mode === "tailscale") {
    const platform = await getPlatform();
    const bin = await platform.findBinary(["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]);
    if (!bin) { console.error("tailscale not found on PATH"); process.exit(2); }
    const { stdout } = await platform.runBinary(bin, ["ip", "-4"], { timeoutMs: 5000 });
    const ip = String(stdout).split(/\s+/).find(Boolean);
    if (!ip) { console.error("could not determine the tailnet address"); process.exit(2); }
    return ip;
  }
  if (mode === "lan") {
    if (!argv.includes("--yes-lan")) {
      console.error("binding the LAN needs --yes-lan as well, since anyone on the network can then reach the dashboard");
      process.exit(2);
    }
    return "0.0.0.0";
  }
  return null;
}

async function loadEverything() {
  await ensureDirs();
  const config = await loadConfig();
  const { manifests, errors } = await loadRegistry(config);
  return { config, manifests, errors };
}

function activeManifests(config, manifests) {
  return manifests.filter((manifest) => providerEnablement(config, manifest).active);
}

async function cmdServe() {
  const { config, manifests, errors } = await loadEverything();
  for (const error of errors) log("registry.error", error);

  const exposeHost = await resolveExposeHost(flag("expose"));
  const host = String(flag("host") || exposeHost || config.server.host);
  const port = Number(flag("port") || config.server.port);

  const [writeToken, readToken] = await Promise.all([loadToken("write"), loadToken("read")]);
  assertExposureAllowed(host, readToken);

  const active = activeManifests(config, manifests);
  const activeIds = new Set(active.map((m) => m.id));
  const auth = makeAuth({ writeToken, readToken });

  const scheduler = createScheduler({ manifests: active, config, runProvider, log });
  const server = createServer({ config, manifests, auth, activeIds, scheduler, log });

  try {
    await listen(server, { host, port });
  } catch (error) {
    console.error(`could not bind ${host}:${port} - ${error.message}`);
    process.exit(1);
  }

  scheduler.start();
  log("listening", {
    url: `http://${host}:${port}/`,
    providers: active.map((m) => m.id),
    readAuth: auth.readTokenConfigured ? "token" : "open",
  });
  if (!active.length) log("no_providers", { hint: "run: ai-usage-bar doctor" });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => { scheduler.stop(); server.close(() => process.exit(0)); });
  }
}

async function cmdDoctor() {
  const { config, manifests, errors } = await loadEverything();
  const paths = describePaths();
  const platform = await getPlatform();
  const snapshot = await readSnapshot();

  console.log(`ai-usage-bar doctor\n`);
  console.log(`platform      ${platform.os}${platform.automation.available ? " (browser automation available)" : ""}`);
  console.log(`config        ${paths.config}${config.__missing ? " (not created yet)" : ""}`);
  console.log(`state         ${paths.state}`);
  console.log(`allowed tiers ${(config.allowTiers || []).join(", ") || "(none)"}\n`);

  for (const error of errors) console.log(`  ! ${error.origin} provider '${error.id}' failed to load: ${error.message}`);

  console.log("providers:");
  for (const manifest of manifests) {
    const { active, reason } = providerEnablement(config, manifest);
    const entry = snapshot.providers?.[manifest.id];
    const status = !active
      ? (reason === "tier_not_allowed" ? `off (tier '${manifest.tier}' not in allowTiers)` : "off (not enabled)")
      : entry?.error ? `error: ${entry.error}`
      : entry ? `ok, ${entry.meters?.length || 0} meter(s), captured ${entry.capturedAt}`
      : "enabled, no data yet";
    console.log(`  ${active ? "*" : "-"} ${manifest.id.padEnd(14)} ${manifest.tier.padEnd(22)} ${status}`);
  }

  if (activeManifests(config, manifests).length) {
    const health = buildHealth({ snapshot, manifests, activeIds: new Set(activeManifests(config, manifests).map((m) => m.id)) });
    console.log(`\nhealth        ${health.ok ? "ok" : `stale: ${health.staleProviders.join(", ") || "-"} failing: ${health.failingProviders.join(", ") || "-"}`}`);
  } else {
    console.log(`\nNothing is enabled yet. Edit ${paths.config} - for example:`);
    console.log(JSON.stringify({ providers: { codex: { enabled: true } } }, null, 2));
  }
}

async function cmdToken() {
  const kind = argv[1];
  if (kind !== "read" && kind !== "write") { console.error("usage: ai-usage-bar token <read|write> [--new]"); process.exit(2); }
  await ensureDirs();
  if (argv.includes("--new")) {
    const { token, file } = await createToken(kind);
    console.log(token);
    console.error(`\nsaved to ${file} (mode 0600)`);
    return;
  }
  const existing = await loadToken(kind);
  if (!existing) { console.error(`no ${kind} token yet - create one with: ai-usage-bar token ${kind} --new`); process.exit(1); }
  console.log(existing);
}

async function cmdCollect() {
  const { config, manifests } = await loadEverything();
  const id = String(flag("provider") || argv[1] || "");
  const targets = id ? manifests.filter((m) => m.id === id) : activeManifests(config, manifests);
  if (!targets.length) { console.error(id ? `unknown provider '${id}'` : "no providers enabled"); process.exit(2); }
  for (const manifest of targets) {
    const result = await runProvider(manifest, config, { log });
    console.log(JSON.stringify({ provider: manifest.id, error: result.error, meters: result.meters }, null, 2));
  }
}

async function cmdInit() {
  await ensureDirs();
  const config = await loadConfig();
  const { manifests } = await loadRegistry(config);
  const providers = { ...config.providers };
  for (const manifest of manifests) {
    if (!Object.hasOwn(providers, manifest.id)) {
      providers[manifest.id] = { enabled: SAFE_TIERS.includes(manifest.tier), ...providerConfig(config, manifest) };
    }
  }
  const file = await saveConfig({ ...DEFAULT_CONFIG, ...config, providers });
  console.log(`wrote ${file}`);
  console.log("Safe-tier providers are enabled by default. Review the file, then run: ai-usage-bar doctor");
}

const COMMANDS = { serve: cmdServe, doctor: cmdDoctor, token: cmdToken, collect: cmdCollect, init: cmdInit };

if (command === "help" || command === "--help" || command === "-h") {
  console.log(`ai-usage-bar - how much of your AI subscriptions is left

  ai-usage-bar init                     write a starter config
  ai-usage-bar doctor                   what this machine can read, and why not
  ai-usage-bar serve [--port N]         run the dashboard (loopback by default)
  ai-usage-bar serve --expose tailscale bind the tailnet address (needs a read token)
  ai-usage-bar collect [--provider id]  run collectors once and print the result
  ai-usage-bar token read --new         create a token for remote access

config: ${CONFIG_FILE}`);
  process.exit(0);
}

const handler = COMMANDS[command];
if (!handler) { console.error(`unknown command '${command}' - try: ai-usage-bar help`); process.exit(2); }
handler().catch((error) => { console.error(error?.stack || String(error)); process.exit(1); });
