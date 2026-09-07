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

function presentedToken(req, url) {
  const header = String(req.headers.authorization || "");
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  // Widget hosts (KWGT, Widgy, some Shortcuts actions) cannot set headers.
  // Accepted for reads only, and query strings are never logged.
  const query = url?.searchParams?.get("token");
  return query ? query.trim() : "";
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
    readTokenConfigured: Boolean(readToken),
    writeTokenConfigured: Boolean(writeToken),
  };
}
