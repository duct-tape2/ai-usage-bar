// User configuration.
//
// Everything that used to be a constant in the code lives here: quota totals,
// poll intervals, warning thresholds, which providers are on. A provider that
// changes its weekly cap should be a one-line config edit, not a patch.

import { readFile, writeFile, chmod } from "node:fs/promises";
import { CONFIG_FILE, ensureParent } from "./paths.mjs";
import { SAFE_TIERS } from "./schema.mjs";

export const DEFAULT_CONFIG = {
  server: {
    port: 8791,
    // Loopback by default. Exposure is a configuration decision, never a
    // code default - and beyond loopback a read token is required.
    host: "127.0.0.1",
  },
  thresholds: { warn: 0.75, critical: 0.9 },
  // Riskier collectors ship in the box but stay off until asked for.
  allowTiers: [...SAFE_TIERS],
  locale: "auto",
  providers: {},
};

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function deepMerge(base, override) {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isObject(value) && isObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

function applyEnv(config) {
  const port = Number(process.env.AI_USAGE_BAR_PORT);
  if (Number.isInteger(port) && port > 0 && port < 65536) config.server.port = port;
  const host = (process.env.AI_USAGE_BAR_HOST || "").trim();
  if (host) config.server.host = host;
  return config;
}

export async function loadConfig(file = CONFIG_FILE) {
  let user = {};
  try {
    user = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`config at ${file} is not valid JSON: ${error.message}`);
  }
  return applyEnv(deepMerge(DEFAULT_CONFIG, user));
}

export async function saveConfig(config, file = CONFIG_FILE) {
  await ensureParent(file);
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
  return file;
}

/** Per-provider settings: manifest defaults, then whatever the user set. */
export function providerConfig(config, manifest) {
  const declared = manifest.config || {};
  const defaults = Object.fromEntries(
    Object.entries(declared).map(([key, spec]) => [key, spec?.default]),
  );
  const user = config.providers?.[manifest.id] || {};
  return { ...defaults, ...user };
}

/**
 * A provider runs only when the user enabled it AND its risk tier is allowed.
 * Both conditions are reported separately so `doctor` can say which one is
 * the reason rather than just "off".
 */
export function providerEnablement(config, manifest) {
  const user = config.providers?.[manifest.id] || {};
  const tierAllowed = (config.allowTiers || []).includes(manifest.tier);
  const enabled = user.enabled === true;
  return {
    enabled,
    tierAllowed,
    active: enabled && tierAllowed,
    reason: !enabled ? "not_enabled" : !tierAllowed ? "tier_not_allowed" : null,
  };
}
