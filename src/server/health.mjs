// Per-provider freshness.
//
// The original server had one global 300s staleness threshold and a hardcoded
// list of five collectors. That cannot serve a 120s poll and a once-a-day API
// spend check at the same time, so the threshold now comes from each
// provider's own schedule.

const MIN_STALE_SECONDS = 120;

export function staleAfterSeconds(manifest) {
  const declared = manifest.schedule?.staleAfterSeconds;
  if (Number.isFinite(declared) && declared > 0) return declared;
  const interval = manifest.schedule?.intervalSeconds || 300;
  // Two missed cycles plus slack: one slow run must not raise an alarm.
  return Math.max(MIN_STALE_SECONDS, Math.round(interval * 2.5));
}

export function buildHealth({ snapshot, manifests, activeIds, now = Date.now() }) {
  const providers = {};
  const stale = [];
  const failing = [];

  for (const manifest of manifests) {
    if (activeIds && !activeIds.has(manifest.id)) continue;
    const entry = snapshot.providers?.[manifest.id];
    const capturedMs = Date.parse(entry?.capturedAt || "");
    const threshold = staleAfterSeconds(manifest);

    // A timestamp from the future means a clock problem, not freshness.
    const future = Number.isFinite(capturedMs) && capturedMs > now + 120_000;
    const ageSeconds = Number.isFinite(capturedMs) && !future ? Math.max(0, Math.round((now - capturedMs) / 1000)) : null;
    const isStale = ageSeconds == null || ageSeconds > threshold;

    providers[manifest.id] = {
      displayName: manifest.displayName,
      tier: manifest.tier,
      lastSuccessAt: entry?.error ? null : (entry?.capturedAt || null),
      lastAttemptAt: entry?.capturedAt || null,
      ageSeconds,
      staleAfterSeconds: threshold,
      stale: isStale,
      error: entry?.error || null,
      invalidFutureTimestamp: future,
    };
    if (isStale) stale.push(manifest.id);
    if (entry?.error) failing.push(manifest.id);
  }

  return {
    ok: stale.length === 0 && failing.length === 0,
    checkedAt: new Date(now).toISOString(),
    staleProviders: stale,
    failingProviders: failing,
    providers,
  };
}
