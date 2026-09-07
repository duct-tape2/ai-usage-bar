// Codex CLI subscription limits, read from the rollout files the CLI already
// writes on this machine.
//
// Every Codex turn appends a `token_count` event carrying the account's own
// rate_limits block, so the numbers are the vendor's, not an estimate, and
// reading them costs no network request at all:
//
//   "rate_limits": { "primary":   { "used_percent": 99.0, "window_minutes": 10080,
//                                   "resets_at": 1788747927 },
//                    "secondary": { ... },
//                    "credits":   { "has_credits": false, "balance": "0" } }
//
// The caveat, stated honestly in the UI: this is only as fresh as the user's
// last Codex turn. If they have not used Codex today, the reading is old, and
// `capturedAt` reflects when it was written, not when we read it.

import { readdir, stat, open } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const TAIL_BYTES = 512 * 1024;
const MAX_FILES = 6;

function sessionsRoot(config) {
  return config.sessionsDir || join(config.codexHome || join(homedir(), ".codex"), "sessions");
}

/** Newest rollout files first. The tree is year/month/day, so depth is bounded. */
async function recentRollouts(root, limit = MAX_FILES) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > 4) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl")) {
        try { found.push({ file: full, mtime: (await stat(full)).mtimeMs }); } catch { /* vanished mid-scan */ }
      }
    }
  }
  await walk(root, 0);
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

/** Reads the end of a file without loading a long session into memory. */
async function readTail(file, bytes = TAIL_BYTES) {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, bytes);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

function findRateLimits(text) {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes("rate_limits")) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    const limits = deepFind(parsed, "rate_limits");
    if (limits && typeof limits === "object") return { limits, raw: parsed };
  }
  return null;
}

function deepFind(value, key, depth = 0) {
  if (depth > 6 || value == null || typeof value !== "object") return null;
  if (Object.hasOwn(value, key) && value[key]) return value[key];
  for (const child of Object.values(value)) {
    const hit = deepFind(child, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function windowMeter(window) {
  if (!window || typeof window !== "object") return null;
  const usedPercent = Number(window.used_percent);
  if (!Number.isFinite(usedPercent)) return null;
  const resetsAt = Number(window.resets_at);
  const minutes = Number(window.window_minutes);
  return {
    unit: "percent",
    used: usedPercent,
    total: 100,
    confidence: "exact",
    method: "codex-rollout-file",
    window: {
      kind: "rolling",
      seconds: Number.isFinite(minutes) && minutes > 0 ? minutes * 60 : null,
      resetAt: Number.isFinite(resetsAt) && resetsAt > 0 ? new Date(resetsAt * 1000).toISOString() : null,
      resetSource: "reported",
    },
  };
}

export async function collect(ctx) {
  const root = sessionsRoot(ctx.config);
  const candidates = await recentRollouts(root);
  if (!candidates.length) {
    throw Object.assign(new Error("no codex rollout files"), { code: "not_installed" });
  }

  let hit = null;
  let sourceMtime = null;
  for (const candidate of candidates) {
    const found = findRateLimits(await readTail(candidate.file));
    if (found) { hit = found; sourceMtime = candidate.mtime; break; }
  }
  // Known upstream behaviour: some builds write rate_limits as null for a
  // while. That is missing data, not a broken adapter.
  if (!hit) throw Object.assign(new Error("no rate_limits recorded yet"), { code: "no_data" });

  const meters = {};
  const primary = windowMeter(hit.limits.primary);
  const secondary = windowMeter(hit.limits.secondary);
  if (primary) meters.primary = primary;
  if (secondary) meters.secondary = secondary;

  const credits = hit.limits.credits;
  if (credits && credits.has_credits === true) {
    const balance = Number(credits.balance);
    if (Number.isFinite(balance)) {
      meters.credits = {
        unit: "currency", currency: "USD",
        remaining: balance,
        confidence: "exact",
        method: "codex-rollout-file",
        window: { kind: "none" },
      };
    }
  }

  if (!Object.keys(meters).length) throw Object.assign(new Error("rate_limits had no usable window"), { code: "no_data" });

  // The reading is as old as the session file that carried it.
  const observedAt = Number.isFinite(sourceMtime) ? new Date(sourceMtime).toISOString() : null;
  for (const meter of Object.values(meters)) {
    meter.detail = { noteKey: "codex.freshness", noteParams: observedAt ? { observedAt } : {} };
  }

  await ctx.state.write({ lastObservedAt: observedAt });
  return { meters };
}
