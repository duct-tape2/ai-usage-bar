#!/usr/bin/env node
// Refuses to let personal data reach a public commit.
//
// Runs in CI and from the pre-commit hook. Deliberately contains no personal
// string of its own: the machine-specific patterns are derived at runtime from
// os.userInfo(), so this file stays publishable while still catching leaks.

import { readFileSync, statSync, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { userInfo, homedir } from "node:os";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP_DIRS = new Set([".git", "node_modules", "coverage", ".DS_Store", ".npm-cache"]);
const BINARY_EXT = /\.(png|jpg|jpeg|gif|webp|ico|icns|woff2?|ttf|zip|gz|mp4|pdf)$/i;

// Files allowed to contain Hangul. Everything else must be English or a key.
const HANGUL_ALLOWED = [
  /^README\.ko\.md$/,
  /^docs\/.*\.ko\.md$/,
  /^web\/locales\/ko\.json$/,
  /^src\/providers\/[^/]+\/locales\/ko\.json$/,
];

// This file names the patterns it hunts for, so scanning it would always trip.
const SELF = "scripts/scrub-check.mjs";

const username = String(userInfo().username || "").trim();
const home = homedir();

const RULES = [
  {
    id: "home-path",
    // A real home directory path. Placeholders are fine.
    re: /(?:\/Users\/|\/home\/)(?!you\b|USER\b|user\b|<|\$\{|runner\b)[A-Za-z0-9._-]{2,}/g,
    hint: "absolute home path - use ~ or a ${HOME} placeholder",
  },
  {
    id: "tailnet-ip",
    // Tailscale CGNAT range 100.64.0.0/10.
    re: /\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/g,
    hint: "tailnet IP - never commit a machine address",
  },
  { id: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, hint: "email address" },
  { id: "long-hex", re: /\b[0-9a-f]{32,}\b/g, hint: "hash or key material" },
  { id: "api-key", re: /\b(?:sk-[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{20,})\b/g, hint: "API key" },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, hint: "JWT / access token" },
  { id: "private-runtime", re: /\.hermes\/node/g, hint: "machine-specific node path" },
];

if (username && username.length >= 3 && !/^(root|user|runner|admin|node)$/i.test(username)) {
  RULES.push({ id: "local-username", re: new RegExp(escapeRe(username), "gi"), hint: "local username" });
}
if (home && home !== "/" && home.length > 4) {
  RULES.push({ id: "local-home", re: new RegExp(escapeRe(home), "g"), hint: "local home directory" });
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Never print the offending value itself - that would just move the leak.
function redact(match) {
  if (match.length <= 6) return "*".repeat(match.length);
  return `${match.slice(0, 3)}…${match.slice(-2)} (${match.length} chars)`;
}

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// Scan exactly what a commit could carry: tracked files plus untracked ones
// that .gitignore does not already exclude. Falls back to a plain walk when
// this is not a git checkout (e.g. someone audits an unpacked tarball).
function candidateFiles() {
  if (!existsSync(join(ROOT, ".git"))) return null;
  try {
    const out = execFileSync("git", ["-C", ROOT, "ls-files", "-co", "--exclude-standard", "-z"], {
      encoding: "utf8", maxBuffer: 32 * 1024 * 1024,
    });
    return out.split("\u0000").filter(Boolean).map((rel) => join(ROOT, rel));
  } catch {
    return null;
  }
}

const findings = [];
const files = candidateFiles() || (await walk(ROOT));

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join("/");
  if (rel === SELF) continue;
  if (BINARY_EXT.test(rel)) continue;
  if (statSync(file).size > 2_000_000) continue;

  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  if (text.includes("\u0000")) continue; // binary

  const lines = text.split("\n");
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split("\n").length;
      findings.push({ rel, line, rule: rule.id, hint: rule.hint, sample: redact(m[0]) });
    }
  }

  if (!HANGUL_ALLOWED.some((re) => re.test(rel))) {
    lines.forEach((content, i) => {
      if (/[가-힣]/.test(content)) {
        findings.push({ rel, line: i + 1, rule: "hangul", hint: "Korean text outside a locale file - use an i18n key", sample: "" });
      }
    });
  }
}

if (findings.length) {
  console.error(`scrub-check FAILED - ${findings.length} finding(s)\n`);
  for (const f of findings.slice(0, 60)) {
    console.error(`  ${f.rel}:${f.line}  [${f.rule}] ${f.hint}${f.sample ? `  -> ${f.sample}` : ""}`);
  }
  if (findings.length > 60) console.error(`  ... and ${findings.length - 60} more`);
  console.error("\nNothing personal may reach a public commit. Fix the above and re-run.");
  process.exit(1);
}

console.log(`scrub-check OK - ${files.length} files, ${RULES.length} rules, 0 findings`);
