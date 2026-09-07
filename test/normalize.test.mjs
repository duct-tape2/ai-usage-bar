import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMeter, normalizeProviderResult } from "../src/core/normalize.mjs";

const manifest = {
  id: "demo",
  tier: "vendor-api",
  meters: {
    weekly: { labelKey: "meter.primaryWindow", order: 0, unit: "count", totalFrom: "config.weeklyTotal" },
    spend: { labelKey: "meter.spend", order: 1, unit: "currency", currency: "USD" },
  },
};
const base = { manifest, config: { weeklyTotal: 200 }, capturedAt: "2026-09-07T00:00:00.000Z" };

test("a quota total comes from config, not from a constant", () => {
  const meter = normalizeMeter({ used: 9 }, { ...base, meterKey: "weekly", meterDef: manifest.meters.weekly });
  assert.equal(meter.total, 200);
  assert.equal(meter.remaining, 191);
  assert.equal(meter.usedRatio, 9 / 200);
});

test("percent providers get a total without declaring one", () => {
  const meter = normalizeMeter({ unit: "percent", used: 99 }, { ...base, meterKey: "weekly", meterDef: {} });
  assert.equal(meter.total, 100);
  assert.equal(meter.remaining, 1);
  assert.equal(meter.usedRatio, 0.99);
  assert.equal(meter.state, "critical");
});

test("used is derived when only remaining and total are reported", () => {
  const meter = normalizeMeter({ unit: "count", remaining: 40, total: 50 }, { ...base, meterKey: "weekly", meterDef: {} });
  assert.equal(meter.used, 10);
  assert.equal(meter.usedRatio, 0.2);
});

test("state follows the configured thresholds", () => {
  const at = (ratio) => normalizeMeter({ unit: "percent", used: ratio * 100 },
    { ...base, meterKey: "weekly", meterDef: {}, thresholds: { warn: 0.5, critical: 0.8 } }).state;
  assert.equal(at(0.1), "ok");
  assert.equal(at(0.6), "warn");
  assert.equal(at(0.85), "critical");
  assert.equal(at(1), "exhausted");
});

test("usedRatio is clamped so a provider over its own cap still renders", () => {
  const meter = normalizeMeter({ unit: "percent", used: 140 }, { ...base, meterKey: "weekly", meterDef: {} });
  assert.equal(meter.usedRatio, 1);
  assert.equal(meter.remaining, 0);
  assert.equal(meter.state, "exhausted");
});

test("a meter reports the route actually taken, not just the manifest tier", () => {
  const meter = normalizeMeter({ unit: "percent", used: 1, tier: "local-file" },
    { ...base, meterKey: "weekly", meterDef: {} });
  assert.equal(meter.source.tier, "local-file");
  assert.equal(manifest.tier, "vendor-api");
});

test("a failed collection keeps the last known numbers but marks them stale", () => {
  const previous = [{ meterKey: "weekly", unit: "count", used: 9, total: 200, remaining: 191 }];
  const meters = normalizeProviderResult({ manifest, result: null, config: { weeklyTotal: 200 }, capturedAt: base.capturedAt, error: "auth_expired", previous });
  const weekly = meters.find((m) => m.meterKey === "weekly");
  assert.equal(weekly.remaining, 191, "a blank card reads as 'you have used nothing', which is worse than stale");
  assert.equal(weekly.stale, true);
  assert.equal(weekly.error, "auth_expired");
  assert.equal(weekly.state, "stale");
});

test("dynamic meters stay absent until the provider actually reports them", () => {
  const withDynamic = { ...manifest, meters: { ...manifest.meters, bonus: { labelKey: "meter.credits", dynamic: true, unit: "currency" } } };
  const meters = normalizeProviderResult({ manifest: withDynamic, result: { meters: { weekly: { used: 1 } } }, config: { weeklyTotal: 200 }, capturedAt: base.capturedAt });
  assert.equal(meters.some((m) => m.meterKey === "bonus"), false);
  assert.equal(meters.some((m) => m.meterKey === "spend"), true, "non-dynamic meters always appear so widgets never branch on a missing key");
});

test("a transient failure keeps the last known reset time, not just the numbers", () => {
  const manifest = { id: "p", vendor: "v", meters: { fiveHour: { unit: "percent", window: { kind: "rolling", seconds: 18000 } } } };
  const previous = [{
    meterKey: "fiveHour", used: 40, total: 100, remaining: 60, unit: "percent",
    window: { kind: "rolling", seconds: 18000, resetAt: "2026-09-07T05:00:00.000Z", resetSource: "reported" },
  }];
  const [m] = normalizeProviderResult({ manifest, result: null, config: {}, thresholds: { warn: 0.75, critical: 0.9 }, capturedAt: "2026-09-07T04:00:00.000Z", error: "network", previous });
  assert.equal(m.stale, true);
  assert.equal(m.remaining, 60);
  assert.equal(m.window.resetAt, "2026-09-07T05:00:00.000Z");
  assert.equal(m.window.resetSource, "reported");
});
