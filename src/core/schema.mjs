// The wire vocabulary.
//
// Two jobs:
//   1. Define one meter shape that fits BOTH a subscription quota ("7 of 200
//      Pro messages this week") and API-key spend ("$3.12 of $400"). Without
//      this, every provider grows its own bespoke card and the UI rots.
//   2. Act as the redaction guarantee. `pickAllowed` is an allowlist, not a
//      denylist, and everything leaving the process passes through it. A
//      conversation id, an account hash or an access token cannot reach the
//      wire because those keys are simply not in the list.

export const UNITS = ["percent", "count", "currency", "tokens", "boolean"];

// How the number was obtained. Shown as a chip on every card - no competing
// dashboard tells you where its numbers came from.
// Ordered by how much trust the user is extending, not alphabetically:
//   official-api        a documented endpoint, user-supplied key
//   local-file          reads state the vendor's own app wrote here; no network
//   vendor-api          the vendor's own API, for this account only, using the
//                       credential their app already stored on this machine
//   session-scrape      a borrowed browser session or scraped markup
//   browser-automation  drives a logged-in browser
//
// The first three are on by default. The last two are the ones that can get an
// account flagged, so they ship in the box but stay off until asked for.
export const TIERS = ["official-api", "local-file", "vendor-api", "session-scrape", "browser-automation"];
export const SAFE_TIERS = ["official-api", "local-file", "vendor-api"];

export const CONFIDENCE = ["exact", "lower-bound", "estimate"];
export const WINDOW_KINDS = ["rolling", "calendar", "none"];
export const STATES = ["ok", "warn", "critical", "exhausted", "unknown", "stale"];
export const RESET_SOURCES = ["reported", "derived", "configured", "unknown"];

/** Every key a meter may carry on the wire. Anything else is dropped. */
export const METER_KEYS = [
  "id", "providerId", "meterKey",
  "unit", "currency",
  "used", "total", "remaining", "usedRatio",
  "window", "source", "confidence",
  "capturedAt", "receivedAt", "stale", "degraded", "error",
  "caps", "state", "detail",
];

const WINDOW_KEYS = ["kind", "seconds", "resetAt", "resetSource"];
const SOURCE_KEYS = ["adapter", "tier", "method", "docUrl"];
const CAPS_KEYS = ["hasRemaining", "hasTotal", "hasReset", "hasCost", "hasHistory"];
// `detail` is adapter-owned but still allowlisted: structured values only, no prose.
const DETAIL_KEYS = ["models", "noteKey", "noteParams", "extra"];
const MODEL_KEYS = ["nameKey", "name", "used", "total", "remaining", "unit", "currency"];

export const ERROR_CODES = [
  "auth_missing", "auth_expired", "auth_rejected",
  "not_installed", "not_logged_in", "unsupported_platform",
  "rate_limited", "network", "timeout",
  "schema_changed", "no_data", "unknown",
];

const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);
const isIsoDate = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));

function pick(source, keys) {
  if (!source || typeof source !== "object") return undefined;
  const out = {};
  for (const key of keys) {
    if (Object.hasOwn(source, key) && source[key] !== undefined) out[key] = source[key];
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Strips a meter down to the allowlist. This is the last thing that runs
 * before anything is written to disk or sent over HTTP.
 */
export function pickAllowed(meter) {
  const out = pick(meter, METER_KEYS) || {};
  if (out.window) out.window = pick(out.window, WINDOW_KEYS);
  if (out.source) out.source = pick(out.source, SOURCE_KEYS);
  if (out.caps) out.caps = pick(out.caps, CAPS_KEYS);
  if (out.detail) {
    const detail = pick(out.detail, DETAIL_KEYS);
    if (detail?.models) {
      detail.models = Array.isArray(detail.models)
        ? detail.models.map((m) => pick(m, MODEL_KEYS)).filter(Boolean).slice(0, 40)
        : undefined;
    }
    // noteParams may only carry scalars - an object here is how prose sneaks back in.
    if (detail?.noteParams && typeof detail.noteParams === "object") {
      const params = {};
      for (const [k, v] of Object.entries(detail.noteParams)) {
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") params[k] = v;
      }
      detail.noteParams = Object.keys(params).length ? params : undefined;
    }
    out.detail = detail && Object.keys(detail).length ? detail : undefined;
  }
  return out;
}

/**
 * Structural validation. Returns a list of human-readable problems; an empty
 * list means the meter is publishable. Used by `test-provider` so a third
 * party finds out what is wrong before their users do.
 */
export function validateMeter(meter) {
  const problems = [];
  const req = (cond, msg) => { if (!cond) problems.push(msg); };

  req(typeof meter?.id === "string" && meter.id.includes("."), "id must be '<providerId>.<meterKey>'");
  req(UNITS.includes(meter?.unit), `unit must be one of ${UNITS.join(", ")}`);
  if (meter?.unit === "currency") req(typeof meter.currency === "string" && meter.currency.length === 3, "currency required for unit 'currency'");

  for (const key of ["used", "total", "remaining", "usedRatio"]) {
    const v = meter?.[key];
    req(v === null || v === undefined || isFiniteNumber(v), `${key} must be a finite number or null`);
  }
  if (isFiniteNumber(meter?.usedRatio)) req(meter.usedRatio >= 0 && meter.usedRatio <= 1, "usedRatio must be within 0..1");

  req(CONFIDENCE.includes(meter?.confidence), `confidence must be one of ${CONFIDENCE.join(", ")}`);
  req(TIERS.includes(meter?.source?.tier), `source.tier must be one of ${TIERS.join(", ")}`);
  req(STATES.includes(meter?.state), `state must be one of ${STATES.join(", ")}`);
  req(isIsoDate(meter?.capturedAt), "capturedAt must be an ISO timestamp");

  if (meter?.window) {
    req(WINDOW_KINDS.includes(meter.window.kind), `window.kind must be one of ${WINDOW_KINDS.join(", ")}`);
    req(meter.window.resetAt == null || isIsoDate(meter.window.resetAt), "window.resetAt must be an ISO timestamp or null");
    req(meter.window.resetSource == null || RESET_SOURCES.includes(meter.window.resetSource), "window.resetSource invalid");
  }
  if (meter?.error != null) req(ERROR_CODES.includes(meter.error), `error must be a code, not prose (${ERROR_CODES.join(", ")})`);

  return problems;
}

/**
 * Adapters cannot declare capabilities - they are read back off the data, so
 * a provider is unable to claim it reports a remaining count that it does not
 * actually produce.
 */
export function deriveCaps(meter) {
  return {
    hasRemaining: isFiniteNumber(meter.remaining),
    hasTotal: isFiniteNumber(meter.total),
    hasReset: isIsoDate(meter.window?.resetAt),
    hasCost: meter.unit === "currency",
    hasHistory: false,
  };
}
