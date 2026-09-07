// Where things live.
//
// The one rule this module exists to enforce: the install directory is
// read-only at runtime. Config, secrets and state go to XDG locations so that
// `npx ai-usage-bar` and a git clone behave identically, and so that a secret
// can never end up sitting next to the code that reads it.
//
// XDG variables are honoured on macOS too. That is deliberate - it keeps the
// Linux and macOS docs identical, which is most of the support burden.

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdir, chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const APP = "ai-usage-bar";
const HOME = homedir();

function xdg(envName, fallback) {
  const value = process.env[envName];
  return value && value.startsWith("/") ? value : fallback;
}

export const INSTALL_DIR = fileURLToPath(new URL("../..", import.meta.url));
export const WEB_DIR = join(INSTALL_DIR, "web");

export const CONFIG_DIR = process.env.AI_USAGE_BAR_CONFIG_DIR
  || join(xdg("XDG_CONFIG_HOME", join(HOME, ".config")), APP);

export const STATE_DIR = process.env.AI_USAGE_BAR_STATE_DIR
  || join(xdg("XDG_STATE_HOME", join(HOME, ".local", "state")), APP);

export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const SECRETS_DIR = join(CONFIG_DIR, "secrets");
export const EXTERNAL_PROVIDERS_DIR = join(CONFIG_DIR, "providers");

export const USAGE_FILE = join(STATE_DIR, "usage.json");
export const COLLECTOR_STATE_DIR = join(STATE_DIR, "collectors");
export const HISTORY_DIR = join(STATE_DIR, "history");

export function secretFile(name) {
  return join(SECRETS_DIR, `${name}.json`);
}

export function collectorStateFile(providerId) {
  return join(COLLECTOR_STATE_DIR, `${providerId}.json`);
}

/** Creates the directories we own, with private permissions. */
export async function ensureDirs() {
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await mkdir(SECRETS_DIR, { recursive: true, mode: 0o700 });
  await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
  await mkdir(COLLECTOR_STATE_DIR, { recursive: true, mode: 0o700 });
  // recursive mkdir ignores mode on an existing dir, so restate it.
  for (const dir of [CONFIG_DIR, SECRETS_DIR, STATE_DIR]) {
    await chmod(dir, 0o700).catch(() => {});
  }
}

export async function ensureParent(file) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
}

/** Human-readable summary for `doctor`, with $HOME collapsed so it is safe to paste. */
export function describePaths() {
  const tidy = (p) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
  return {
    install: tidy(INSTALL_DIR),
    config: tidy(CONFIG_DIR),
    secrets: tidy(SECRETS_DIR),
    state: tidy(STATE_DIR),
    usage: tidy(USAGE_FILE),
  };
}
