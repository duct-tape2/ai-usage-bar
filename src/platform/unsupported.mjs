// Fallback adapter for platforms with no specific support yet (Windows today).
// Local-file and API providers still work; anything needing a shell helper or
// a browser reports unsupported_platform rather than failing obscurely.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { platform, homedir } from "node:os";
import { join } from "node:path";
import { UnsupportedPlatformError } from "./index.mjs";

const run = promisify(execFile);

export default {
  os: platform(),
  async findBinary(names) {
    for (const name of [].concat(names)) {
      try {
        const { stdout } = await run(process.platform === "win32" ? "where" : "which", [name], { timeout: 3000 });
        const first = String(stdout).split(/\r?\n/).find(Boolean);
        if (first) return first.trim();
      } catch { /* not found */ }
    }
    return null;
  },
  async runBinary(bin, args, { timeoutMs = 15_000, maxBuffer = 8 * 1024 * 1024, input } = {}) {
    const { stdout, stderr } = await run(bin, args, { timeout: timeoutMs, maxBuffer, encoding: "utf8", input });
    return { stdout, stderr };
  },
  automation: {
    available: false,
    evalInTab() { throw new UnsupportedPlatformError("browser automation"); },
  },
  paths: {
    logs: join(homedir(), ".ai-usage-bar", "logs"),
    appSupport: homedir(),
  },
};
