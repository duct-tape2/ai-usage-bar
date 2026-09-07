// Runs one provider and stores the result.
//
// Everything an adapter would otherwise have to repeat lives here: building
// the context, enforcing a timeout, namespacing meter ids, stamping
// timestamps, turning a thrown error into a typed code, and keeping the last
// known numbers visible when a collection fails. An adapter is left with the
// only part that is actually provider-specific - reading the number.

import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { normalizeProviderResult } from "./normalize.mjs";
import { providerConfig } from "./config.mjs";
import { createHttp, HttpError } from "./http.mjs";
import { secretsFor } from "./secrets.mjs";
import { getPlatform, UnsupportedPlatformError } from "../platform/index.mjs";
import { collectorStateFile, ensureParent } from "./paths.mjs";
import { ERROR_CODES } from "./schema.mjs";
import { putProvider, readSnapshot } from "../server/store.mjs";

const DEFAULT_TIMEOUT_MS = 45_000;

function collectorState(providerId) {
  const file = collectorStateFile(providerId);
  return {
    async read() {
      try { return JSON.parse(await readFile(file, "utf8")); } catch { return {}; }
    },
    async write(value) {
      await ensureParent(file);
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(value ?? {}), { mode: 0o600 });
      await rename(temp, file);
      await chmod(file, 0o600).catch(() => {});
    },
  };
}

/** Every failure becomes one of the schema's codes. Prose never reaches a meter. */
export function toErrorCode(error) {
  if (error instanceof UnsupportedPlatformError) return "unsupported_platform";
  if (error instanceof HttpError) return error.code;
  const code = error?.code;
  if (typeof code === "string" && ERROR_CODES.includes(code)) return code;
  if (error?.name === "AbortError") return "timeout";
  if (typeof error?.message === "string" && /ENOENT|not found|no such file/i.test(error.message)) return "not_installed";
  return "unknown";
}

export function createContext(manifest, config, { log } = {}) {
  return getPlatform().then((platform) => ({
    config: providerConfig(config, manifest),
    secrets: secretsFor(manifest.id),
    state: collectorState(manifest.id),
    http: createHttp({ log }),
    platform,
    log: (event, fields = {}) => log?.(`${manifest.id}.${event}`, fields),
    now: () => Date.now(),
  }));
}

/**
 * Collects one provider. Never throws: a failure is data the dashboard needs
 * to show, not an exception that should take the scheduler down.
 */
export async function runProvider(manifest, config, { log, persist = true, snapshotFile } = {}) {
  const startedAt = Date.now();
  const capturedAt = new Date().toISOString();
  const timeoutMs = (manifest.schedule?.timeoutSeconds || 0) * 1000 || DEFAULT_TIMEOUT_MS;

  let result = null;
  let error = null;
  try {
    const ctx = await createContext(manifest, config, { log });
    result = await Promise.race([
      manifest.collect(ctx),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("collect timed out"), { code: "timeout" })), timeoutMs)),
    ]);
    if (!result || typeof result !== "object" || typeof result.meters !== "object") {
      error = "schema_changed";
      log?.(`${manifest.id}.bad_result`, {});
    }
  } catch (caught) {
    error = toErrorCode(caught);
    log?.(`${manifest.id}.failed`, { error, durationMs: Date.now() - startedAt });
  }

  const previous = persist
    ? (await readSnapshot(snapshotFile))?.providers?.[manifest.id]?.meters
    : undefined;

  const meters = normalizeProviderResult({
    manifest,
    result,
    config: providerConfig(config, manifest),
    thresholds: config.thresholds,
    capturedAt,
    error,
    previous,
  });

  const payload = { meters, error, capturedAt, meta: { durationMs: Date.now() - startedAt, origin: manifest.origin } };
  if (persist) await putProvider(manifest.id, payload, snapshotFile);
  return payload;
}
