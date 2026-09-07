// Token auth for reads and writes.
//
// The write path is carried over unchanged from the original server: it is
// fail-closed (no token configured means no writes are accepted) and compares
// with timingSafeEqual after a length check.
//
// The read path is new and exists for one reason: the original bound a
// tailnet address while serving reads to anyone who could reach it. That is
// fine for one person on their own tailnet and unacceptable as a default, so
// binding anything other than loopback now requires a read token.

import { timingSafeEqual, randomBytes } from "node:crypto";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { secretFile, ensureParent } from "../core/paths.mjs";

const TOKEN_FILES = {
  write: () => process.env.AI_USAGE_BAR_WRITE_TOKEN_FILE || secretFile("write-token"),
  read: () => process.env.AI_USAGE_BAR_READ_TOKEN_FILE || secretFile("read-token"),
};
const TOKEN_ENV = { write: "AI_USAGE_BAR_WRITE_TOKEN", read: "AI_USAGE_BAR_READ_TOKEN" };

export async function loadToken(kind) {
  const inline = (process.env[TOKEN_ENV[kind]] || "").trim();
  if (inline) return inline;
  try {
    const parsed = JSON.parse(await readFile(TOKEN_FILES[kind](), "utf8"));
    return typeof parsed?.token === "string" ? parsed.token.trim() : "";
  } catch {
    return "";
  }
}

export async function createToken(kind) {
  const token = randomBytes(32).toString("base64url");
  const file = TOKEN_FILES[kind]();
  await ensureParent(file);
  await writeFile(file, JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  await chmod(file, 0o600).catch(() => {});
  return { token, file };
}

function constantTimeEquals(a, b) {
  if (!a || !b) return false;
  const provided = Buffer.from(a, "utf8");
  const expected = Buffer.from(b, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export const READ_COOKIE = "ai_usage_bar_read";

function cookieValue(req, name) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return "";
}

function presentedToken(req, url) {
  const header = String(req.headers.authorization || "");
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  // Widget hosts (KWGT, Widgy, some Shortcuts actions) cannot set headers.
  // Accepted for reads only, and query strings are never logged.
  const query = url?.searchParams?.get("token");
  if (query) return query.trim();
  // A phone opens /?token=... once; the cookie minted for that visit carries
  // the token on every request the page itself makes afterwards.
  return cookieValue(req, READ_COOKIE);
}

function isSecure(req) {
  if (req.socket?.encrypted) return true;
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}

export function isLoopback(req) {
  const address = req.socket?.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function makeAuth({ writeToken, readToken, trustLoopback = true }) {
  return {
    /** Fail-closed: an unset write token rejects every write. */
    canWrite(req, url) {
      if (!writeToken) return false;
      return constantTimeEquals(presentedToken(req, url), writeToken);
    },
    /**
     * With no read token configured the dashboard is open - which is only
     * reachable at all because binding beyond loopback requires one.
     */
    canRead(req, url) {
      if (!readToken) return true;
      if (trustLoopback && isLoopback(req)) return true;
      return constantTimeEquals(presentedToken(req, url), readToken);
    },
    /**
     * The Set-Cookie value to attach when this request proved the read token
     * through the query string, so the dashboard's own fetches work without
     * the token in the address bar. Null when nothing should be set.
     */
    readCookieFor(req, url) {
      if (!readToken) return null;
      const query = url?.searchParams?.get("token");
      if (!query || !constantTimeEquals(query.trim(), readToken)) return null;
      return `${READ_COOKIE}=${readToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${isSecure(req) ? "; Secure" : ""}`;
    },
    readTokenConfigured: Boolean(readToken),
    writeTokenConfigured: Boolean(writeToken),
  };
}
