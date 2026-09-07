// The HTTP surface.
//
// Reads are pure: a GET never triggers an outbound request to a provider.
// The original server fetched a vendor's billing API on every read, which
// makes an exposed endpoint an amplifier - that is fixed here by construction,
// because collection only ever happens on the scheduler's clock.

import http from "node:http";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join, normalize, extname, sep } from "node:path";
import { WEB_DIR } from "../core/paths.mjs";
import { readSnapshot, putProvider } from "./store.mjs";
import { buildHealth } from "./health.mjs";
import { buildSummary, summaryLine } from "./summary.mjs";
import { resolveLang } from "../core/i18n.mjs";
import { isLoopback } from "./auth.mjs";

const MAX_BODY = 1_000_000;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'",
};

function send(res, status, body, contentType = "text/plain; charset=utf-8", extra = {}) {
  res.writeHead(status, { "content-type": contentType, "cache-control": "no-store", ...SECURITY_HEADERS, ...extra });
  res.end(body);
}

function sendJson(res, payload, status = 200, extra = {}) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8", extra);
}

function etagFor(text) {
  return `"${createHash("sha1").update(text).digest("base64url").slice(0, 22)}"`;
}

/** Serves the static dashboard. Whitelisted by resolved path, never by string prefix. */
async function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const resolved = normalize(join(WEB_DIR, rel));
  if (resolved !== WEB_DIR && !resolved.startsWith(WEB_DIR + sep)) return send(res, 403, "forbidden");

  let info;
  try {
    info = await stat(resolved);
    if (!info.isFile()) throw new Error("not a file");
  } catch {
    return send(res, 404, "not found");
  }

  const tag = etagFor(`${resolved}:${info.size}:${info.mtimeMs}`);
  if (req.headers["if-none-match"] === tag) {
    res.writeHead(304, { etag: tag, ...SECURITY_HEADERS });
    return res.end();
  }
  const body = await readFile(resolved);
  res.writeHead(200, {
    "content-type": TYPES[extname(resolved)] || "application/octet-stream",
    "cache-control": "no-cache",
    etag: tag,
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) { req.destroy(); reject(new Error("body too large")); }
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("invalid JSON")); }
    });
    req.on("error", reject);
  });
}

export function createServer({ config, manifests, auth, activeIds, scheduler, log }) {
  async function handle(req, res) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const { pathname } = url;

    if (req.method === "OPTIONS") return send(res, 204, "");

    // Ingest is the extension point for out-of-process collectors: a browser
    // extension, a userscript, or a collector running on another machine.
    if (req.method === "POST" && pathname === "/api/ingest") {
      if (!auth.canWrite(req, url)) return sendJson(res, { error: "unauthorized" }, 401);
      let payload;
      try { payload = await readBody(req); } catch (error) { return sendJson(res, { error: error.message }, 400); }
      const providerId = String(payload.providerId || "");
      if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(providerId)) return sendJson(res, { error: "invalid providerId" }, 400);
      const snapshot = await putProvider(providerId, {
        meters: Array.isArray(payload.meters) ? payload.meters : [],
        error: payload.error || null,
        capturedAt: payload.capturedAt || null,
      });
      log?.("ingest", { provider: providerId, meters: (payload.meters || []).length });
      return sendJson(res, { ok: true, updatedAt: snapshot.updatedAt });
    }

    if (req.method === "POST" && pathname === "/api/refresh") {
      if (!auth.canWrite(req, url) && !isLoopback(req)) return sendJson(res, { error: "unauthorized" }, 401);
      scheduler?.runAllNow().catch(() => {});
      return sendJson(res, { ok: true, started: true });
    }

    if (req.method !== "GET" && req.method !== "HEAD") return sendJson(res, { error: "not found" }, 404);

    if (!auth.canRead(req, url)) return sendJson(res, { error: "unauthorized" }, 401);

    if (pathname === "/api/usage") {
      const snapshot = await readSnapshot();
      return sendJson(res, {
        ...snapshot,
        providerMeta: Object.fromEntries(manifests
          .filter((m) => !activeIds || activeIds.has(m.id))
          .map((m) => [m.id, { displayName: m.displayName, tier: m.tier, group: m.group, meters: m.meters, docUrl: m.docUrl }])),
        health: buildHealth({ snapshot, manifests, activeIds }),
      });
    }

    if (pathname === "/api/summary" || pathname === "/api/summary.txt") {
      const lang = resolveLang(url.searchParams.get("lang") || req.headers["accept-language"]);
      const snapshot = await readSnapshot();
      const summary = await buildSummary({ snapshot, manifests, lang });
      if (pathname.endsWith(".txt")) return send(res, 200, summaryLine(summary));
      const body = JSON.stringify(summary);
      const tag = etagFor(body);
      if (req.headers["if-none-match"] === tag) {
        res.writeHead(304, { etag: tag, ...SECURITY_HEADERS });
        return res.end();
      }
      return sendJson(res, summary, 200, { etag: tag, "cache-control": "no-cache" });
    }

    if (pathname === "/api/health") {
      const snapshot = await readSnapshot();
      const health = buildHealth({ snapshot, manifests, activeIds });
      return sendJson(res, health, health.ok ? 200 : 503);
    }

    if (pathname.startsWith("/api/i18n/")) {
      const lang = resolveLang(pathname.slice("/api/i18n/".length));
      return serveStatic(req, res, `/locales/${lang}.json`);
    }

    if (pathname.startsWith("/api/")) return sendJson(res, { error: "not found" }, 404);
    return serveStatic(req, res, pathname);
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      log?.("request.error", { message: String(error?.message || error) });
      if (!res.headersSent) sendJson(res, { error: "internal error" }, 500);
      else res.end();
    });
  });
}

export function listen(server, { host, port }) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve({ host, port }));
  });
}
