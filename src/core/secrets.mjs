// Per-provider secret storage.
//
// Secrets live under the config directory with 0600 permissions and are
// namespaced by provider, so one adapter cannot read another's credentials by
// guessing a filename. Nothing here is ever serialized into a meter - the
// schema allowlist has no key that could carry it.

import { readFile, writeFile, chmod, unlink } from "node:fs/promises";
import { secretFile, ensureParent } from "./paths.mjs";

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function fileFor(providerId, name) {
  if (!SAFE_NAME.test(providerId) || !SAFE_NAME.test(name)) throw new Error("invalid secret name");
  return secretFile(`${providerId}.${name}`);
}

export function secretsFor(providerId) {
  return {
    async get(name) {
      try {
        const parsed = JSON.parse(await readFile(fileFor(providerId, name), "utf8"));
        return parsed?.value ?? null;
      } catch {
        return null;
      }
    },
    async set(name, value, meta = {}) {
      const file = fileFor(providerId, name);
      await ensureParent(file);
      await writeFile(file, JSON.stringify({ value, ...meta, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
      await chmod(file, 0o600).catch(() => {});
      return file;
    },
    async meta(name) {
      try {
        const { value, ...rest } = JSON.parse(await readFile(fileFor(providerId, name), "utf8"));
        return { present: value != null, ...rest };
      } catch {
        return { present: false };
      }
    },
    async clear(name) {
      await unlink(fileFor(providerId, name)).catch(() => {});
    },
  };
}
