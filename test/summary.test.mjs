import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSummary, summaryLine } from "../src/server/summary.mjs";

const manifests = [{
  id: "demo",
  displayName: "Demo",
  tier: "vendor-api",
  meters: {
    weekly: { labelKey: "meter.primaryWindow", labelFrom: "window" },
    opus: { labelKey: "meter.opusWindow" },
    sonnet: { labelKey: "meter.sonnetWindow" },
  },
}];

function meter(id, over = {}) {
  return {
    id: `demo.${id}`, providerId: "demo", meterKey: id,
    unit: "percent", used: 10, total: 100, remaining: 90, usedRatio: 0.1,
    window: { kind: "rolling", seconds: 604800, resetAt: null, resetSource: "unknown" },
    source: { adapter: "demo", tier: "vendor-api" },
    confidence: "exact", capturedAt: "2026-09-07T00:00:00.000Z", stale: false, error: null,
    caps: {}, state: "ok", ...over,
  };
}

const snapshot = (meters) => ({ v: 1, updatedAt: "2026-09-07T00:00:00.000Z", providers: { demo: { providerId: "demo", meters } } });

test("meters are an array sorted worst-first, so a widget reads index 0", async () => {
  const summary = await buildSummary({
    snapshot: snapshot([
      meter("weekly", { state: "ok", usedRatio: 0.1 }),
      meter("opus", { state: "exhausted", usedRatio: 1 }),
      meter("sonnet", { state: "warn", usedRatio: 0.8 }),
    ]),
    manifests,
  });
  assert.ok(Array.isArray(summary.meters));
  assert.equal(summary.meters[0].id, "demo.opus");
  assert.equal(summary.worst.id, "demo.opus");
  assert.equal(summary.counts.exhausted, 1);
});

test("meters sharing a window length still get distinct labels", async () => {
  const summary = await buildSummary({
    snapshot: snapshot([meter("weekly"), meter("opus"), meter("sonnet")]),
    manifests,
  });
  const labels = summary.meters.map((m) => m.label);
  assert.equal(new Set(labels).size, labels.length, `labels collided: ${labels.join(", ")}`);
});

test("every field a widget reads is always present, even on failure", async () => {
  const summary = await buildSummary({
    snapshot: snapshot([meter("weekly", { state: "unknown", error: "auth_expired", used: null, remaining: null, usedRatio: null })]),
    manifests,
  });
  const row = summary.meters[0];
  for (const key of ["id", "label", "short", "usedRatio", "primaryText", "state", "tier", "stale", "resetAt", "resetInText", "error", "errorText"]) {
    assert.ok(Object.hasOwn(row, key), `${key} must always be present`);
  }
  assert.equal(row.primaryText, "-");
  assert.equal(row.errorText, "Sign-in expired");
});

test("the payload stays inside the widget budget", async () => {
  const many = Array.from({ length: 24 }, (_, i) => meter(`m${i}`));
  const summary = await buildSummary({ snapshot: snapshot(many), manifests });
  const bytes = Buffer.byteLength(JSON.stringify(summary));
  assert.ok(bytes < 8192, `summary was ${bytes} bytes`);
});

test("the one-line form is short enough for a menubar", async () => {
  const summary = await buildSummary({ snapshot: snapshot([meter("weekly"), meter("opus")]), manifests });
  const line = summaryLine(summary);
  assert.ok(line.length < 120, line);
  assert.ok(!line.includes("undefined"));
});
