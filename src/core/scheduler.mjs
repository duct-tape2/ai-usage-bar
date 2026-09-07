// In-process collection loop.
//
// This is what frees the project from launchd/systemd for the common case:
// `ai-usage-bar serve` collects on its own schedule, so the whole thing runs
// on a NAS, in Docker or on a Pi with nothing else installed. OS schedulers
// remain available for the out-of-process providers that need a desktop
// session, but they are no longer required to see a number.

const MIN_INTERVAL_SECONDS = 60;

function jitter(seconds) {
  return Math.round(seconds * (0.9 + Math.random() * 0.2));
}

export function createScheduler({ manifests, config, runProvider, log }) {
  const timers = new Map();
  const inFlight = new Set();
  let stopped = false;

  async function tick(manifest) {
    if (stopped || inFlight.has(manifest.id)) return;
    inFlight.add(manifest.id);
    try {
      const { error } = await runProvider(manifest, config, { log });
      log?.("collect", { provider: manifest.id, ok: !error, ...(error ? { error } : {}) });
    } catch (error) {
      // runProvider is not supposed to throw; if it does, the loop survives.
      log?.("collect.crash", { provider: manifest.id, message: String(error?.message || error) });
    } finally {
      inFlight.delete(manifest.id);
      schedule(manifest);
    }
  }

  function schedule(manifest) {
    if (stopped) return;
    const declared = manifest.schedule?.intervalSeconds ?? 300;
    const configured = config.providers?.[manifest.id]?.intervalSeconds;
    const seconds = Math.max(MIN_INTERVAL_SECONDS, Number(configured) || declared);
    const timer = setTimeout(() => tick(manifest), jitter(seconds) * 1000);
    timer.unref?.();
    timers.set(manifest.id, timer);
  }

  return {
    start() {
      stopped = false;
      // Stagger the first run so a fresh start does not fire every provider
      // in the same second.
      manifests.forEach((manifest, index) => {
        const timer = setTimeout(() => tick(manifest), index * 1500);
        timer.unref?.();
        timers.set(manifest.id, timer);
      });
      return this;
    },
    /** Runs one provider now, outside its schedule (the Refresh button). */
    async runNow(providerId) {
      const manifest = manifests.find((m) => m.id === providerId);
      if (!manifest) return null;
      return tick(manifest);
    },
    async runAllNow() {
      await Promise.all(manifests.map((manifest) => tick(manifest)));
    },
    stop() {
      stopped = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
