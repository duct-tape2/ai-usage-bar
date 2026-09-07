// The widget contract: GET /api/summary
//
// Written for the dumbest possible client. iOS Scriptable, KWGT and Widgy
// cannot do arithmetic, date maths or conditionals, so the server pre-renders
// every string, resolves labels for ?lang, always emits every field, and
// sorts worst-first. A widget reads one value and draws it.
//
// Documented as stable in docs/data-contract.md and versioned with `v`.
// Target: under 4 KB, because this is fetched over cellular on a battery.

import { translator, windowLabel } from "../core/i18n.mjs";

const SEVERITY = { exhausted: 5, critical: 4, warn: 3, stale: 2, unknown: 1, ok: 0 };

function formatNumber(value) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function formatCurrency(value, currency) {
  if (!Number.isFinite(value)) return "-";
  const symbol = currency === "USD" ? "$" : "";
  return `${symbol}${formatNumber(value)}${symbol ? "" : ` ${currency || ""}`}`.trim();
}

/** Remaining-first, because that is the question the project exists to answer. */
function primaryText(meter) {
  if (meter.error && meter.usedRatio == null) return "-";
  if (meter.unit === "currency") {
    if (Number.isFinite(meter.remaining)) return formatCurrency(meter.remaining, meter.currency);
    if (Number.isFinite(meter.used)) return formatCurrency(meter.used, meter.currency);
    return "-";
  }
  if (meter.unit === "count" && Number.isFinite(meter.remaining) && Number.isFinite(meter.total)) {
    return `${formatNumber(meter.remaining)}/${formatNumber(meter.total)}`;
  }
  if (Number.isFinite(meter.usedRatio)) return `${Math.round((1 - meter.usedRatio) * 100)}%`;
  if (Number.isFinite(meter.remaining)) return formatNumber(meter.remaining);
  return "-";
}

function durationText(t, ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return t("window.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${t("window.hours", { n: hours })}${minutes % 60 ? ` ${t("window.minutes", { n: minutes % 60 })}` : ""}`;
  const days = Math.floor(hours / 24);
  return `${t("window.days", { n: days })}${hours % 24 ? ` ${t("window.hours", { n: hours % 24 })}` : ""}`;
}

// Widgets get a handful of characters, so abbreviate rather than truncate:
// "Codex wk" reads; "Codex wee…" does not.
const SHORT_WINDOW = { weekly: "wk", daily: "d", monthly: "mo" };

function shortLabel(displayName, windowText, max = 12) {
  const name = displayName.split(/\s+/)[0].slice(0, 6);
  const tail = SHORT_WINDOW[windowText] || windowText.replace(/\s+/g, "").slice(0, 5);
  const combined = `${name} ${tail}`;
  return combined.length <= max ? combined : `${combined.slice(0, max - 1).trimEnd()}…`;
}

export async function buildSummary({ snapshot, manifests, lang = "en", now = Date.now() }) {
  const t = await translator(lang);
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const rows = [];

  for (const entry of Object.values(snapshot.providers || {})) {
    const manifest = byId.get(entry.providerId);
    const displayName = manifest?.displayName || entry.providerId;
    for (const meter of entry.meters || []) {
      const meterDef = manifest?.meters?.[meter.meterKey] || {};
      // Some meters ARE their window (a plan's primary/secondary limit, whose
      // length varies per account); others are distinct limits that happen to
      // share a window length, and naming those by duration makes three
      // different Claude limits render as one repeated row.
      const nameByWindow = meterDef.labelFrom === "window" && Number.isFinite(meter.window?.seconds);
      const windowText = nameByWindow
        ? windowLabel(t, meter.window.seconds)
        : t(meterDef.labelKey || `meter.${meter.meterKey}`);
      const resetMs = meter.window?.resetAt ? Date.parse(meter.window.resetAt) - now : NaN;

      rows.push({
        id: meter.id,
        label: `${displayName} ${windowText}`,
        short: shortLabel(displayName, windowText),
        usedRatio: Number.isFinite(meter.usedRatio) ? Math.round(meter.usedRatio * 1000) / 1000 : null,
        primaryText: primaryText(meter),
        state: meter.state || "unknown",
        tier: meter.source?.tier || null,
        confidence: meter.confidence || null,
        stale: meter.stale === true,
        resetAt: meter.window?.resetAt || null,
        resetAtEpoch: meter.window?.resetAt ? Math.floor(Date.parse(meter.window.resetAt) / 1000) : null,
        resetInText: durationText(t, resetMs),
        error: meter.error || null,
        errorText: meter.error ? t(`error.${meter.error}`) : null,
      });
    }
  }

  rows.sort((a, b) => (SEVERITY[b.state] ?? 0) - (SEVERITY[a.state] ?? 0)
    || (b.usedRatio ?? -1) - (a.usedRatio ?? -1)
    || a.id.localeCompare(b.id));

  const counts = { ok: 0, warn: 0, critical: 0, exhausted: 0, unknown: 0, stale: 0 };
  for (const row of rows) counts[row.state] = (counts[row.state] || 0) + 1;

  const updatedAt = snapshot.updatedAt || null;
  return {
    v: 1,
    updatedAt,
    updatedAtEpoch: updatedAt ? Math.floor(Date.parse(updatedAt) / 1000) : null,
    ok: counts.critical === 0 && counts.exhausted === 0 && counts.stale === 0,
    worst: rows[0] || null,
    meters: rows,
    counts,
  };
}

/** One line for Shortcuts, a menubar title, or `watch` in a terminal. */
export function summaryLine(summary) {
  if (!summary.meters.length) return "no providers";
  const parts = summary.meters.slice(0, 6).map((m) => {
    const flag = m.state === "exhausted" ? "!" : m.state === "critical" ? "*" : "";
    return `${m.short} ${m.primaryText}${flag}`;
  });
  return parts.join(" | ");
}
