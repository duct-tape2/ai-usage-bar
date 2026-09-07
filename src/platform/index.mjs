// Everything OS-specific lives behind this adapter.
//
// The core is plain Node and runs on a NAS, in a container, on a Pi. Only the
// parts that genuinely need a desktop - driving a logged-in browser tab,
// talking to launchd - are platform code, and they announce their absence
// with a typed error instead of crashing an unrelated provider.

import { platform } from "node:os";

export class UnsupportedPlatformError extends Error {
  constructor(feature) {
    super(`${feature} is not available on this platform`);
    this.code = "unsupported_platform";
    this.feature = feature;
  }
}

let cached = null;

export async function getPlatform() {
  if (cached) return cached;
  const os = platform();
  const module = os === "darwin"
    ? await import("./darwin.mjs")
    : os === "linux"
      ? await import("./linux.mjs")
      : await import("./unsupported.mjs");
  cached = module.default;
  return cached;
}
