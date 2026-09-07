// Translation on the server.
//
// The API never returns human prose - meters carry keys and numbers. But a
// phone widget cannot ship a locale bundle, so /api/summary resolves labels
// server-side using ?lang. That is the single exception, and it is why this
// lives in core rather than in the browser.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { WEB_DIR, INSTALL_DIR } from "./paths.mjs";

const FALLBACK = "en";
const cache = new Map();

async function loadBundle(lang) {
  if (cache.has(lang)) return cache.get(lang);
  let bundle = {};
  try {
    bundle = JSON.parse(await readFile(join(WEB_DIR, "locales", `${lang}.json`), "utf8"));
  } catch {
    bundle = {};
  }

  // Providers ship their own note strings so an adapter never has to touch a
  // core locale file to add one.
  const providersDir = join(INSTALL_DIR, "src", "providers");
  let entries = [];
  try { entries = await readdir(providersDir, { withFileTypes: true }); } catch { /* none */ }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const extra = JSON.parse(await readFile(join(providersDir, entry.name, "locales", `${lang}.json`), "utf8"));
      bundle = { ...extra, ...bundle };
    } catch { /* provider has no locale for this language */ }
  }

  cache.set(lang, bundle);
  return bundle;
}

export function resolveLang(requested, available = ["en", "ko"]) {
  const candidates = String(requested || "")
    .split(",")
    .map((part) => part.split(";")[0].trim().toLowerCase())
    .filter(Boolean);
  for (const candidate of candidates) {
    if (available.includes(candidate)) return candidate;
    const base = candidate.split("-")[0];
    if (available.includes(base)) return base;
  }
  return FALLBACK;
}

export async function translator(lang) {
  const bundle = await loadBundle(lang);
  const fallback = lang === FALLBACK ? bundle : await loadBundle(FALLBACK);
  return function t(key, params = {}) {
    const template = bundle[key] ?? fallback[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] === undefined ? `{${name}}` : String(params[name])));
  };
}

/**
 * Turns a window length into something short enough for a widget: "weekly",
 * "5h", "30d". Doing this from seconds keeps provider manifests free of
 * per-window label keys.
 */
export function windowLabel(t, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return t("window.none");
  if (seconds === 604800) return t("window.weekly");
  if (seconds === 86400) return t("window.daily");
  if (seconds >= 2419200 && seconds <= 2678400) return t("window.monthly");
  if (seconds < 3600) return t("window.minutes", { n: Math.round(seconds / 60) });
  if (seconds < 86400) return t("window.hours", { n: Math.round(seconds / 3600) });
  return t("window.days", { n: Math.round(seconds / 86400) });
}
