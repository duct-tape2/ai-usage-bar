// Finds providers: the ones that ship in the box, plus anything the user
// dropped into their config directory.
//
// External adapters are arbitrary code, so they load only when the user has
// named them in config. Discovery alone never executes a stranger's module.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { EXTERNAL_PROVIDERS_DIR } from "./paths.mjs";
import { TIERS, UNITS, CONFIDENCE } from "./schema.mjs";

const BUILT_IN = ["codex", "claude-code", "cursor", "chatgpt-pro"];

/** Rejects a manifest that would produce meters the UI cannot render. */
export function validateManifest(manifest, origin = "built-in") {
  const problems = [];
  const req = (cond, msg) => { if (!cond) problems.push(msg); };

  req(typeof manifest?.id === "string" && /^[a-z0-9][a-z0-9-]{1,31}$/.test(manifest.id), "id must be lowercase kebab-case");
  req(typeof manifest?.displayName === "string" && manifest.displayName.length > 0, "displayName is required");
  req(TIERS.includes(manifest?.tier), `tier must be one of ${TIERS.join(", ")}`);
  req(typeof manifest?.collect === "function", "collect must be a function");
  req(manifest?.meters && Object.keys(manifest.meters).length > 0, "at least one meter must be declared");

  for (const [key, def] of Object.entries(manifest?.meters || {})) {
    req(/^[a-zA-Z0-9_]{1,32}$/.test(key), `meter key '${key}' must be alphanumeric`);
    req(typeof def?.labelKey === "string", `meter '${key}' needs a labelKey`);
    req(!def?.unit || UNITS.includes(def.unit), `meter '${key}' has an unknown unit`);
    req(!def?.confidence || CONFIDENCE.includes(def.confidence), `meter '${key}' has an unknown confidence`);
  }

  const interval = manifest?.schedule?.intervalSeconds;
  // A floor, not a suggestion. Polling a provider faster than this is what
  // gets a user rate-limited, and this project will not ship that behaviour.
  req(!interval || interval >= 60, "schedule.intervalSeconds must be at least 60");

  return problems.map((p) => `${origin}:${manifest?.id || "?"} ${p}`);
}

async function loadModule(url, origin) {
  const module = await import(url);
  const manifest = module.default;
  const problems = validateManifest(manifest, origin);
  if (problems.length) throw new Error(problems.join("; "));
  return { ...manifest, origin };
}

export async function loadRegistry(config = {}, { includeExternal = true } = {}) {
  const manifests = [];
  const errors = [];

  for (const id of BUILT_IN) {
    try {
      manifests.push(await loadModule(new URL(`../providers/${id}/provider.mjs`, import.meta.url).href, "built-in"));
    } catch (error) {
      errors.push({ id, origin: "built-in", message: error.message });
    }
  }

  if (includeExternal) {
    let entries = [];
    try {
      entries = await readdir(EXTERNAL_PROVIDERS_DIR, { withFileTypes: true });
    } catch { /* no external providers, which is the normal case */ }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Only load what the user explicitly configured.
      if (!Object.hasOwn(config.providers || {}, entry.name)) continue;
      const file = join(EXTERNAL_PROVIDERS_DIR, entry.name, "provider.mjs");
      try {
        const manifest = await loadModule(pathToFileURL(file).href, "external");
        if (manifest.id !== entry.name) throw new Error(`manifest id '${manifest.id}' does not match directory '${entry.name}'`);
        manifests.push(manifest);
      } catch (error) {
        errors.push({ id: entry.name, origin: "external", message: error.message });
      }
    }
  }

  manifests.sort((a, b) => (a.group?.order ?? 50) - (b.group?.order ?? 50) || a.id.localeCompare(b.id));
  return { manifests, errors };
}
