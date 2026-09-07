import { test } from "node:test";
import assert from "node:assert/strict";
import { makeAuth, READ_COOKIE } from "../src/server/auth.mjs";

const TOKEN = "abc123tokenXYZ";
function req(headers = {}, remote = "203.0.113.9") {
  return { headers, socket: { remoteAddress: remote } };
}
const url = (q = "") => new URL(`http://host/api/usage${q}`);

test("read token is accepted from header, query, or the minted cookie", () => {
  const auth = makeAuth({ writeToken: "w", readToken: TOKEN });
  assert.equal(auth.canRead(req(), url()), false);
  assert.equal(auth.canRead(req({ authorization: `Bearer ${TOKEN}` }), url()), true);
  assert.equal(auth.canRead(req(), url(`?token=${TOKEN}`)), true);
  assert.equal(auth.canRead(req({ cookie: `other=1; ${READ_COOKIE}=${TOKEN}` }), url()), true);
  assert.equal(auth.canRead(req({ cookie: `${READ_COOKIE}=wrong` }), url()), false);
});

test("a valid ?token= visit mints the cookie; anything else does not", () => {
  const auth = makeAuth({ writeToken: "w", readToken: TOKEN });
  const cookie = auth.readCookieFor(req(), url(`?token=${TOKEN}`));
  assert.ok(cookie.startsWith(`${READ_COOKIE}=${TOKEN}; Path=/; HttpOnly; SameSite=Lax`));
  assert.ok(!cookie.includes("Secure"), "plain http must not set Secure");
  assert.ok(auth.readCookieFor(req({ "x-forwarded-proto": "https" }), url(`?token=${TOKEN}`)).includes("Secure"));
  assert.equal(auth.readCookieFor(req(), url(`?token=wrong`)), null);
  assert.equal(auth.readCookieFor(req({ authorization: `Bearer ${TOKEN}` }), url()), null);
  assert.equal(makeAuth({ writeToken: "w", readToken: "" }).readCookieFor(req(), url(`?token=x`)), null);
});
