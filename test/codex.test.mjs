import { test } from "node:test";
import assert from "node:assert/strict";
import { windowMeter } from "../src/providers/codex/collect.mjs";
import { validateMeter } from "../src/core/schema.mjs";

const WEEK_MIN = 7 * 24 * 60;

test("a live window is reported exactly as Codex wrote it", () => {
  const now = Date.parse("2026-09-07T05:00:00Z");
  const m = windowMeter({ used_percent: 99, window_minutes: WEEK_MIN, resets_at: Math.floor(now / 1000) + 3600 }, now);
  assert.equal(m.used, 99);
  assert.equal(m.confidence, "exact");
  assert.equal(m.window.resetSource, "reported");
  assert.equal(Date.parse(m.window.resetAt), now + 3600_000);
});

test("a window whose reset has passed is reported as fresh, not almost out", () => {
  const now = Date.parse("2026-09-07T05:00:00Z");
  const resetsAt = Math.floor(now / 1000) - 2 * 3600; // rolled over two hours ago
  const m = windowMeter({ used_percent: 99, window_minutes: WEEK_MIN, resets_at: resetsAt }, now);
  assert.equal(m.used, 0);
  assert.equal(m.confidence, "estimate");
  assert.equal(m.window.resetSource, "derived");
  assert.ok(Date.parse(m.window.resetAt) > now, "reset must be rolled forward into the future");
  assert.equal(Date.parse(m.window.resetAt), resetsAt * 1000 + WEEK_MIN * 60_000);
});

test("a lapsed window without a known length drops the reset instead of guessing", () => {
  const now = Date.parse("2026-09-07T05:00:00Z");
  const m = windowMeter({ used_percent: 40, resets_at: Math.floor(now / 1000) - 60 }, now);
  assert.equal(m.used, 0);
  assert.equal(m.window.resetAt, null);
});
