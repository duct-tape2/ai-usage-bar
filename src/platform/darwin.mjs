// macOS platform adapter.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { UnsupportedPlatformError } from "./index.mjs";

const run = promisify(execFile);
const BIN_DIRS = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", join(homedir(), ".local", "bin")];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findBinary(names) {
  for (const name of [].concat(names)) {
    if (name.startsWith("/")) {
      try { await access(name, constants.X_OK); return name; } catch { continue; }
    }
    for (const dir of BIN_DIRS) {
      const candidate = join(dir, name);
      try { await access(candidate, constants.X_OK); return candidate; } catch { /* keep looking */ }
    }
    try {
      const { stdout } = await run("/usr/bin/which", [name], { timeout: 3000 });
      const found = stdout.trim();
      if (found) return found;
    } catch { /* not on PATH */ }
  }
  return null;
}

async function runBinary(bin, args, { timeoutMs = 15_000, maxBuffer = 8 * 1024 * 1024, input } = {}) {
  const { stdout, stderr } = await run(bin, args, { timeout: timeoutMs, maxBuffer, encoding: "utf8", input });
  return { stdout, stderr };
}

/**
 * Runs JavaScript inside a browser tab the user already has open.
 *
 * It never navigates, reloads or focuses anything - the whole point is that
 * the earlier design, which drove a dedicated tab through page loads every 15
 * seconds, is what tripped provider rate-limit warnings. This only evaluates
 * an expression in a page that is already loaded.
 *
 * Requires Chrome's View > Developer > "Allow JavaScript from Apple Events".
 */
async function evalInTab(urlPattern, expression, { timeoutMs = 25_000, browser = "/Applications/Google Chrome.app" } = {}) {
  const job = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const pattern = urlPattern instanceof RegExp ? urlPattern.source : String(urlPattern);

  const wrap = (js) => `(() => {
    const app = Application(${JSON.stringify(browser)});
    if (!app.running()) throw new Error('browser-not-running');
    const re = new RegExp(${JSON.stringify(pattern)});
    let tab = null;
    for (const w of app.windows()) for (const t of w.tabs()) {
      if (re.test(String(t.url()))) { tab = t; break; }
    }
    if (!tab) throw new Error('tab-required');
    return tab.execute({ javascript: ${JSON.stringify(js)} });
  })()`;

  const osa = async (js) => {
    try {
      const { stdout } = await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", wrap(js)], {
        timeout: 15_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8",
      });
      return String(stdout).trim();
    } catch (error) {
      const stderr = String(error?.stderr || "");
      if (stderr.includes("browser-not-running")) throw new UnsupportedPlatformError("browser automation (browser not running)");
      if (stderr.includes("tab-required")) throw new UnsupportedPlatformError("browser automation (no matching tab open)");
      throw new UnsupportedPlatformError("browser automation");
    }
  };

  const kick = `(() => { const K = "__aiUsageBar"; window[K] = window[K] || {}; const J = ${JSON.stringify(job)};
    window[K][J] = { state: "running" };
    (async () => { try { window[K][J] = { state: "done", out: await (${expression})() }; }
      catch (e) { window[K][J] = { state: "error", err: String((e && e.message) || e) }; } })();
    return "started"; })()`;

  await osa(kick);
  const read = `JSON.stringify((window.__aiUsageBar || {})[${JSON.stringify(job)}] || { state: "missing" })`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(600);
    let parsed;
    try { parsed = JSON.parse(await osa(read)); } catch { continue; }
    if (parsed.state === "done") {
      await osa(`(() => { try { delete window.__aiUsageBar[${JSON.stringify(job)}]; } catch (e) {} return "ok"; })()`).catch(() => {});
      return parsed.out;
    }
    if (parsed.state === "error") throw new Error(parsed.err || "tab-eval-failed");
    if (parsed.state === "missing") throw new Error("tab-context-lost");
  }
  throw new Error("tab-eval-timeout");
}

export default {
  os: "darwin",
  findBinary,
  runBinary,
  automation: { available: true, evalInTab },
  paths: {
    logs: join(homedir(), "Library", "Logs", "ai-usage-bar"),
    appSupport: join(homedir(), "Library", "Application Support"),
  },
};
