// The only outbound HTTP an adapter is allowed to make.
//
// Routing every provider request through one helper is what lets the project
// promise good-citizen behaviour: a hard timeout, no redirect to another
// origin, one place to enforce a floor on request volume, and an honest
// user-agent. An adapter that calls global fetch directly bypasses all of it,
// which the conformance kit flags.

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class HttpError extends Error {
  constructor(code, status, message) {
    super(message || code);
    this.code = code;
    this.status = status;
  }
}

/**
 * Maps transport failures onto the schema's error codes, never prose.
 *
 * A 403 that answers with HTML is a bot-protection challenge, not a rejected
 * credential. Calling that "sign-in rejected" sends people off to re-authenticate
 * a token that was fine, so it is reported as rate limiting - which is both
 * closer to the truth and the behaviour that should follow: back off.
 */
export function classifyStatus(status, contentType = "") {
  if (status === 401) return "auth_expired";
  if (status === 403) return contentType.includes("html") ? "rate_limited" : "auth_rejected";
  if (status === 429) return "rate_limited";
  return "network";
}

function assertSameOrigin(from, to) {
  const a = new URL(from);
  const b = new URL(to, from);
  if (a.origin !== b.origin) throw new HttpError("network", 0, "cross-origin redirect refused");
  return b;
}

export function createHttp({ userAgent, log } = {}) {
  const ua = userAgent || "ai-usage-bar (+https://github.com/duct-tape2/ai-usage-bar)";

  async function request(url, { method = "GET", headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, accept = "application/json" } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { accept, "user-agent": ua, ...headers },
        body,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      throw new HttpError(error?.name === "AbortError" ? "timeout" : "network", 0, error?.message);
    }

    try {
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new HttpError("network", response.status, "redirect without location");
        clearTimeout(timer);
        return request(assertSameOrigin(url, location).toString(), { method, headers, body, timeoutMs, accept });
      }
      if (!response.ok) throw new HttpError(classifyStatus(response.status, response.headers.get("content-type") || ""), response.status, `HTTP ${response.status}`);
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getJson(url, options = {}) {
      const response = await request(url, { ...options, method: "GET" });
      return readJson(response, url, log);
    },
    async postJson(url, payload, options = {}) {
      const response = await request(url, {
        ...options,
        method: "POST",
        headers: { "content-type": "application/json", ...(options.headers || {}) },
        body: typeof payload === "string" ? payload : JSON.stringify(payload),
      });
      return readJson(response, url, log);
    },
    async getText(url, options = {}) {
      const response = await request(url, { ...options, method: "GET", accept: options.accept || "text/plain" });
      return response.text();
    },
  };
}

async function readJson(response, url, log) {
  const type = response.headers.get("content-type") || "";
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError("schema_changed", response.status, "response too large");
  if (!type.includes("json")) {
    // Almost always an interstitial or a login page where JSON was expected.
    log?.("http.non_json", { host: safeHost(url), status: response.status });
    throw new HttpError("schema_changed", response.status, "expected JSON");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError("schema_changed", response.status, "malformed JSON");
  }
}

function safeHost(url) {
  try { return new URL(url).host; } catch { return "?"; }
}
