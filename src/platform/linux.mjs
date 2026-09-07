// Linux platform adapter. No desktop automation: the point of running here is
// a headless box, so browser-tier providers report unsupported_platform and
// every other provider works normally.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { UnsupportedPlatformError } from "./index.mjs";

const run = promisify(execFile);
const BIN_DIRS = ["/usr/local/bin", "/usr/bin", "/bin", "/snap/bin", join(homedir(), ".local", "bin")];

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
      if (stdout.trim()) return stdout.trim();
    } catch { /* not on PATH */ }
  }
  return null;
}

async function runBinary(bin, args, { timeoutMs = 15_000, maxBuffer = 8 * 1024 * 1024, input } = {}) {
  const { stdout, stderr } = await run(bin, args, { timeout: timeoutMs, maxBuffer, encoding: "utf8", input });
  return { stdout, stderr };
}

export default {
  os: "linux",
  findBinary,
  runBinary,
  automation: {
    available: false,
    evalInTab() { throw new UnsupportedPlatformError("browser automation"); },
  },
  paths: {
    logs: join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "ai-usage-bar", "logs"),
    appSupport: join(homedir(), ".config"),
  },
};
