// The usage snapshot on disk.
//
// The atomic-write and serialized-queue behaviour is carried over unchanged
// from the original single-user server, where it has been running for months:
// write to a temp file, rename into place, and funnel every write through one
// promise chain so two collectors finishing at the same instant cannot
// interleave and lose each other's meters.
//
// Providers are replaced whole. A collector owns its providerId and nothing
// else, which is what the old `replaceGroups` allowlist was groping towards.

import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import { USAGE_FILE, ensureParent } from "../core/paths.mjs";
import { pickAllowed } from "../core/schema.mjs";

const EMPTY = { v: 1, updatedAt: null, providers: {} };

let writeQueue = Promise.resolve();

export async function readSnapshot(file = USAGE_FILE) {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.providers !== "object") return { ...EMPTY };
    return { ...EMPTY, ...parsed };
  } catch {
    return { ...EMPTY };
  }
}

async function writeSnapshot(data, file = USAGE_FILE) {
  await ensureParent(file);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(temp, file);
  await chmod(file, 0o600).catch(() => {});
}

/**
 * Replaces one provider's meters. Every meter passes through the schema
 * allowlist on the way in, so nothing an adapter accidentally attached can
 * reach the file - and therefore cannot reach the HTTP response either.
 */
export function putProvider(providerId, { meters, error = null, capturedAt = null, meta = null }, file = USAGE_FILE) {
  const update = writeQueue.then(async () => {
    const current = await readSnapshot(file);
    const receivedAt = new Date().toISOString();
    current.providers[providerId] = {
      providerId,
      meters: (meters || []).map(pickAllowed).map((m) => ({ ...m, receivedAt })),
      error,
      capturedAt: capturedAt || receivedAt,
      receivedAt,
      ...(meta ? { meta } : {}),
    };
    const next = { v: 1, updatedAt: receivedAt, providers: current.providers };
    await writeSnapshot(next, file);
    return next;
  });
  writeQueue = update.then(() => undefined, () => undefined);
  return update;
}

export function removeProvider(providerId, file = USAGE_FILE) {
  const update = writeQueue.then(async () => {
    const current = await readSnapshot(file);
    delete current.providers[providerId];
    const next = { v: 1, updatedAt: new Date().toISOString(), providers: current.providers };
    await writeSnapshot(next, file);
    return next;
  });
  writeQueue = update.then(() => undefined, () => undefined);
  return update;
}

/** Flat, ordered list of every meter across providers. */
export function flattenMeters(snapshot) {
  const meters = [];
  for (const entry of Object.values(snapshot.providers || {})) {
    for (const meter of entry.meters || []) meters.push(meter);
  }
  return meters;
}
