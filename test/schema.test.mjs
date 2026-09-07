import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAllowed, validateMeter, deriveCaps, TIERS, SAFE_TIERS } from "../src/core/schema.mjs";

const FAKE = {
  token: ["sk", "ant", "oat01", "x".repeat(24)].join("-"),
  uuid: ["6a9e0305", "c608", "83e9", "809f", "6".repeat(12)].join("-"),
  hash: "a".repeat(64),
  email: ["someone", "example.com"].join("@"),
  homeDir: ["", "Users", "someone", ".config"].join("/"),
};

// The redaction promise. If this test ever fails, the project has stopped
// being safe to expose on a network.
test("pickAllowed drops anything not on the allowlist", () => {
  const meter = pickAllowed({
    id: "chatgpt-pro.proWeekly",
    providerId: "chatgpt-pro",
    meterKey: "proWeekly",
    unit: "count",
    used: 9,
    total: 200,
    // Everything below is the sort of thing an adapter might carry internally.
    // Built at runtime rather than written out, so the fixtures cannot trip
    // the publishing scrubber - and so a real value can never be pasted here
    // by accident and sit in the repository looking like test data.
    accessToken: FAKE.token,
    conversationIds: [FAKE.uuid],
    accountHash: FAKE.hash,
    email: FAKE.email,
    homeDir: FAKE.homeDir,
    cookies: { session: "abc" },
  });

  assert.equal(meter.used, 9);
  for (const leaked of ["accessToken", "conversationIds", "accountHash", "email", "homeDir", "cookies"]) {
    assert.equal(Object.hasOwn(meter, leaked), false, `${leaked} must not survive`);
  }
});

test("nested objects are allowlisted too", () => {
  const meter = pickAllowed({
    id: "x.y",
    window: { kind: "rolling", seconds: 3600, resetAt: null, rawCookie: "nope" },
    source: { adapter: "x", tier: "local-file", authHeader: "Bearer nope" },
    detail: { models: [{ name: "m", used: 1, secretId: "nope" }], noteKey: "a.b", noteParams: { n: 1, obj: { deep: true } } },
  });

  assert.equal(Object.hasOwn(meter.window, "rawCookie"), false);
  assert.equal(Object.hasOwn(meter.source, "authHeader"), false);
  assert.equal(Object.hasOwn(meter.detail.models[0], "secretId"), false);
  // noteParams may only carry scalars, so prose cannot re-enter through it.
  assert.equal(Object.hasOwn(meter.detail.noteParams, "obj"), false);
  assert.equal(meter.detail.noteParams.n, 1);
});

test("validateMeter rejects prose in the error field", () => {
  const problems = validateMeter({
    id: "a.b", unit: "percent", confidence: "exact", state: "ok",
    source: { tier: "local-file" }, capturedAt: new Date().toISOString(),
    error: "Could not reach the provider, please sign in again",
  });
  assert.ok(problems.some((p) => p.includes("error must be a code")));
});

test("validateMeter accepts a well-formed meter", () => {
  const problems = validateMeter({
    id: "codex.primary", unit: "percent", used: 99, total: 100, remaining: 1, usedRatio: 0.99,
    confidence: "exact", state: "critical", source: { tier: "local-file" },
    window: { kind: "rolling", seconds: 604800, resetAt: new Date().toISOString(), resetSource: "reported" },
    capturedAt: new Date().toISOString(), error: null,
  });
  assert.deepEqual(problems, []);
});

test("capabilities are derived, so an adapter cannot overstate them", () => {
  const caps = deriveCaps({ remaining: null, total: 200, unit: "count", window: { resetAt: null } });
  assert.equal(caps.hasRemaining, false);
  assert.equal(caps.hasTotal, true);
  assert.equal(caps.hasReset, false);
  assert.equal(caps.hasCost, false);
});

test("risky tiers are not enabled by default", () => {
  assert.ok(TIERS.includes("session-scrape"));
  assert.ok(TIERS.includes("browser-automation"));
  assert.equal(SAFE_TIERS.includes("session-scrape"), false);
  assert.equal(SAFE_TIERS.includes("browser-automation"), false);
});
