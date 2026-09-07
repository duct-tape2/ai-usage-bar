// Turns a raw adapter reading into a publishable meter.
//
// This file replaces the per-service `if (id === "...")` chain that the
// original single-user server grew. It contains no provider names and no
// service ids: everything specific to a provider is declared in that
// provider's manifest, so adding a provider never means editing core.

import { deriveCaps, pickAllowed, TIERS } from "./schema.mjs";

const DEFAULT_THRESHOLDS = { warn: 0.75, critical: 0.9 };

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const iso = (v) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);

/**
 * Resolves a manifest reference such as "config.weeklyTotal".
 * This is how a quota like 200/week becomes user configuration instead of a
 * constant buried in five files.
 */
function resolveRef(ref, scope) {
  if (typeof ref === "number") return ref;
  if (typeof ref !== "string") return null;
  let cursor = scope;
  for (const part of ref.split(".")) {
    if (cursor == null || typeof cursor !== "object") return null;
    cursor = cursor[part];
  }
  return num(cursor);
}

function resolveWindow(rawWindow, declared) {
  const merged = { kind: "none", seconds: null, resetAt: null, resetSource: "unknown", ...declared, ...rawWindow };
  const resetAt = iso(merged.resetAt);
  return {
    kind: merged.kind,
    seconds: num(merged.seconds),
    resetAt,
    resetSource: resetAt ? (merged.resetSource === "unknown" ? "reported" : merged.resetSource) : "unknown",
  };
}

/**
 * Fills in whichever of used / total / remaining / usedRatio can be derived
 * from the others. Adapters report what their provider actually gives them
 * and never have to do this arithmetic.
 */
function reconcileAmounts(raw, unit, declaredTotal) {
  let used = num(raw.used);
  let total = num(raw.total) ?? declaredTotal;
  let remaining = num(raw.remaining);
  let usedRatio = num(raw.usedRatio);

  if (unit === "percent") {
    // A percent provider reports 0..100 and rarely states a total.
    if (total == null) total = 100;
    if (used == null && remaining != null) used = total - remaining;
    if (used == null && usedRatio != null) used = usedRatio * total;
  }

  if (used == null && total != null && remaining != null) used = total - remaining;
  if (remaining == null && total != null && used != null) remaining = total - used;
  if (usedRatio == null && total != null && total > 0 && used != null) usedRatio = used / total;

  if (remaining != null) remaining = Math.max(0, remaining);
  if (usedRatio != null) usedRatio = Math.min(1, Math.max(0, usedRatio));

  return { used, total, remaining, usedRatio };
}

function deriveState({ usedRatio, stale, error, thresholds }) {
  if (stale) return "stale";
  if (error) return "unknown";
  if (usedRatio == null) return "unknown";
  if (usedRatio >= 1) return "exhausted";
  if (usedRatio >= thresholds.critical) return "critical";
  if (usedRatio >= thresholds.warn) return "warn";
  return "ok";
}

/**
 * @param raw       what the adapter returned for one meter
 * @param context   { manifest, meterKey, meterDef, config, thresholds, capturedAt, error, stale }
 */
export function normalizeMeter(raw, context) {
  const { manifest, meterKey, meterDef = {}, config = {}, capturedAt } = context;
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(context.thresholds || {}) };
  const unit = raw?.unit || meterDef.unit || "percent";

  const declaredTotal = resolveRef(meterDef.totalFrom, { config });
  const amounts = reconcileAmounts(raw || {}, unit, declaredTotal);
  const stale = context.stale === true;
  const error = context.error ?? raw?.error ?? null;

  const meter = {
    id: `${manifest.id}.${meterKey}`,
    providerId: manifest.id,
    meterKey,
    unit,
    currency: unit === "currency" ? (raw?.currency || meterDef.currency || "USD") : undefined,
    ...amounts,
    window: resolveWindow(raw?.window, meterDef.window),
    source: {
      adapter: manifest.id,
      // A provider may have several routes to the same number. The manifest
      // tier is the riskiest one it may use (that is what the allowTiers gate
      // checks); each meter reports the route actually taken.
      tier: TIERS.includes(raw?.tier) ? raw.tier : manifest.tier,
      method: raw?.method || meterDef.method || undefined,
      docUrl: meterDef.docUrl || manifest.docUrl || undefined,
    },
    confidence: raw?.confidence || meterDef.confidence || "exact",
    capturedAt: capturedAt || new Date().toISOString(),
    stale,
    degraded: context.degraded === true,
    error,
    detail: raw?.detail,
  };

  meter.caps = deriveCaps(meter);
  meter.state = deriveState({ usedRatio: meter.usedRatio, stale, error, thresholds });
  return pickAllowed(meter);
}

/**
 * Builds the meters for one provider run. On failure we still emit a meter per
 * declared key so the dashboard shows a labelled error card rather than a
 * silently missing row - and so a widget never has to branch on a missing key.
 */
export function normalizeProviderResult({ manifest, result, config, thresholds, capturedAt, error, previous }) {
  const meters = [];
  const declared = manifest.meters || {};
  const rawMeters = (!error && result?.meters) || {};
  const keys = new Set([...Object.keys(declared), ...Object.keys(rawMeters)]);

  for (const meterKey of keys) {
    const meterDef = declared[meterKey] || {};
    if (meterDef.dynamic && !Object.hasOwn(rawMeters, meterKey)) continue;

    const raw = rawMeters[meterKey];
    if (error || raw === undefined) {
      // Keep the last known numbers visible, but mark them stale. A blank card
      // is indistinguishable from "you have used nothing", which is worse.
      const last = previous?.find((m) => m.meterKey === meterKey);
      meters.push(normalizeMeter(
        last ? { used: last.used, total: last.total, remaining: last.remaining, unit: last.unit, currency: last.currency, detail: last.detail, window: last.window } : {},
        { manifest, meterKey, meterDef, config, thresholds, capturedAt, error: error || "no_data", stale: true },
      ));
      continue;
    }
    meters.push(normalizeMeter(raw, { manifest, meterKey, meterDef, config, thresholds, capturedAt }));
  }

  meters.sort((a, b) => (declared[a.meterKey]?.order ?? 99) - (declared[b.meterKey]?.order ?? 99) || a.id.localeCompare(b.id));
  return meters;
}
