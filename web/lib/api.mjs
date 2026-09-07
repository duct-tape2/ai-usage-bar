// Every network call is bounded. A dashboard that hangs is worse than one
// that says it could not reach the daemon, so each request carries its own
// AbortController and reports a locale key rather than a raw exception.

const DEFAULT_TIMEOUT = 8000;

function classify(error, status) {
  if (status === 401 || status === 403) return "auth_missing";
  if (status === 429) return "rate_limited";
  if (status && status >= 500) return "unknown";
  const name = error && error.name;
  if (name === "TimeoutError" || name === "AbortError") return "timeout";
  return "network";
}

export class ApiError extends Error {
  constructor(code, status) {
    super(`api:${code}`);
    this.name = "ApiError";
    this.code = code;
    this.status = status || 0;
  }
}

async function request(path, { method = "GET", timeout = DEFAULT_TIMEOUT } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method,
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
  } catch (error) {
    throw new ApiError(classify(error, 0));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new ApiError(classify(null, res.status), res.status);
  try {
    return await res.json();
  } catch {
    throw new ApiError("schema_changed", res.status);
  }
}

export function getUsage(options) {
  return request("/api/usage", options);
}

export function postRefresh(options) {
  return request("/api/refresh", { ...options, method: "POST", timeout: 12000 });
}
