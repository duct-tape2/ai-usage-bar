// Claude subscription limits (Pro / Max).
//
// Uses the OAuth credential the Claude Code CLI already stored on this
// machine to ask Anthropic about this account's own usage windows. No browser
// session is borrowed and no page is scraped - it is the vendor's API, for
// the signed-in account, with the vendor's own token.
//
// The endpoint is not documented, so it sits in the `vendor-api` tier and the
// UI says so on the card. If Anthropic publishes an official one, only the
// `method` string here needs to change.
//
// API-key-only setups have no subscription and therefore no windows; that is
// reported as auth_missing rather than pretending the quota is unknown.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const OAUTH_BETA = "oauth-2025-04-20";

// Anthropic reports several windows; each becomes its own meter so the card
// can show "5h" and "weekly" side by side.
const WINDOWS = [
  { key: "fiveHour", field: "five_hour", seconds: 5 * 3600 },
  { key: "sevenDay", field: "seven_day", seconds: 7 * 86400 },
  { key: "sevenDayOpus", field: "seven_day_opus", seconds: 7 * 86400 },
  { key: "sevenDaySonnet", field: "seven_day_sonnet", seconds: 7 * 86400 },
];

function readCandidate(parsed, source) {
  const oauth = parsed?.claudeAiOauth || parsed || {};
  const token = oauth.accessToken;
  if (typeof token !== "string" || token.length < 20) return null;
  const expiresAt = Number(oauth.expiresAt);
  return { token, source, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
}

async function fromCredentialsFile(config) {
  const file = config.credentialsFile || join(config.claudeHome || join(homedir(), ".claude"), ".credentials.json");
  try {
    return readCandidate(JSON.parse(await readFile(file, "utf8")), "file");
  } catch {
    return null;
  }
}

// On macOS the CLI keeps the live credential in the login keychain and lets
// the on-disk copy go stale, so both are read and the fresher one wins.
async function fromKeychain(ctx) {
  if (ctx.platform?.os !== "darwin") return null;
  try {
    const { stdout } = await ctx.platform.runBinary("/usr/bin/security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"], { timeoutMs: 5000 });
    return readCandidate(JSON.parse(String(stdout).trim()), "keychain");
  } catch {
    return null;
  }
}

/** Newest non-expired credential across every source. */
async function pickCredential(ctx) {
  const candidates = (await Promise.all([fromKeychain(ctx), fromCredentialsFile(ctx.config)])).filter(Boolean);
  if (!candidates.length) return { credential: null, reason: "auth_missing" };
  const usable = candidates
    .filter((c) => c.expiresAt == null || c.expiresAt > Date.now() + 60_000)
    .sort((a, b) => (b.expiresAt ?? Infinity) - (a.expiresAt ?? Infinity));
  // Refreshing is the CLI's job, not ours - we never hold a refresh token.
  if (!usable.length) return { credential: null, reason: "auth_expired" };
  return { credential: usable[0], reason: null };
}

function windowMeter(payload, seconds) {
  if (!payload || typeof payload !== "object") return null;
  const utilization = Number(payload.utilization ?? payload.used_percentage);
  if (!Number.isFinite(utilization)) return null;
  const resetAt = payload.resets_at ?? payload.reset_at ?? null;
  const parsed = typeof resetAt === "number" ? new Date(resetAt * 1000).toISOString()
    : (resetAt && Number.isFinite(Date.parse(resetAt)) ? new Date(resetAt).toISOString() : null);
  return {
    unit: "percent",
    used: utilization,
    total: 100,
    confidence: "exact",
    tier: "vendor-api",
    method: "anthropic-oauth-usage",
    window: { kind: "rolling", seconds, resetAt: parsed, resetSource: parsed ? "reported" : "unknown" },
  };
}

export async function collect(ctx) {
  const { credential, reason } = await pickCredential(ctx);
  if (!credential) {
    throw Object.assign(new Error(`no usable Claude OAuth credential (${reason})`), { code: reason });
  }
  ctx.log?.("credential", { source: credential.source });

  const payload = await ctx.http.getJson(USAGE_URL, {
    headers: { authorization: `Bearer ${credential.token}`, "anthropic-beta": OAUTH_BETA },
    timeoutMs: 12_000,
  });

  const meters = {};
  for (const { key, field, seconds } of WINDOWS) {
    const meter = windowMeter(payload?.[field], seconds);
    if (meter) meters[key] = meter;
  }

  // Overflow credit, when the account actually has it switched on.
  //
  // The amounts are minor units and the response says how many decimal places
  // to apply: monthly_limit 20000 with decimal_places 2 is $200.00, not
  // $20,000. Ignoring that field puts a number 100x too large on the card.
  const extra = payload?.extra_usage;
  if (extra?.is_enabled === true && Number.isFinite(Number(extra.monthly_limit)) && Number(extra.monthly_limit) > 0) {
    const places = Number.isFinite(Number(extra.decimal_places)) ? Number(extra.decimal_places) : 0;
    const scale = 10 ** places;
    meters.extraUsage = {
      unit: "currency",
      currency: typeof extra.currency === "string" && extra.currency.length === 3 ? extra.currency : "USD",
      used: (Number(extra.used_credits) || 0) / scale,
      total: Number(extra.monthly_limit) / scale,
      confidence: "exact",
      tier: "vendor-api",
      method: "anthropic-oauth-usage",
      window: { kind: "calendar", seconds: 30 * 86400 },
    };
  }

  if (!Object.keys(meters).length) {
    // A valid response with no windows means this credential has no
    // subscription attached - an API key, or a plan that exposes nothing.
    throw Object.assign(new Error("no subscription windows in response"), { code: "no_data" });
  }
  return { meters };
}
