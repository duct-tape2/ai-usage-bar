// Number, label and clock formatting.
//
// Mirrors the server's summary contract on purpose: the widget payload and the
// dashboard must never disagree about what "1%" means. Everything here is
// remaining-first - the question this project answers is how much is LEFT.

export const SEVERITY = { exhausted: 5, critical: 4, warn: 3, stale: 2, unknown: 1, ok: 0 };

export function formatNumber(value, locale) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString(locale);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/\.?0+$/, "");
}

export function formatCurrency(value, currency, locale) {
  if (!Number.isFinite(value)) return "-";
  try {
    // Money keeps its cents when it has them and drops them when it does not:
    // rounding $1,299.76 up to $1,300 would overstate what is left.
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${formatNumber(value, locale)} ${currency || ""}`.trim();
  }
}

/** The headline: what is left, in the unit the meter is denominated in. */
export function remainingText(meter, locale) {
  if (meter.unit === "currency") {
    if (Number.isFinite(meter.remaining)) return formatCurrency(meter.remaining, meter.currency, locale);
    if (Number.isFinite(meter.used)) return formatCurrency(meter.used, meter.currency, locale);
    return "-";
  }
  if (meter.unit === "count" && Number.isFinite(meter.total)) {
    // The denominator is worth keeping even when the numerator is unknown:
    // "-/200" says which allowance is being talked about, "-" says nothing.
    const left = Number.isFinite(meter.remaining) ? formatNumber(meter.remaining, locale) : "-";
    return `${left}/${formatNumber(meter.total, locale)}`;
  }
  if (Number.isFinite(meter.usedRatio)) return `${Math.round((1 - meter.usedRatio) * 100)}%`;
  if (Number.isFinite(meter.remaining)) return formatNumber(meter.remaining, locale);
  return "-";
}

/** 0..1 of the allowance still available, or null when the meter cannot say. */
export function remainingRatio(meter) {
  if (Number.isFinite(meter.usedRatio)) return Math.min(1, Math.max(0, 1 - meter.usedRatio));
  if (Number.isFinite(meter.remaining) && Number.isFinite(meter.total) && meter.total > 0) {
    return Math.min(1, Math.max(0, meter.remaining / meter.total));
  }
  return null;
}

export function windowLabel(t, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return t("window.none");
  if (seconds === 604800) return t("window.weekly");
  if (seconds === 86400) return t("window.daily");
  if (seconds >= 2419200 && seconds <= 2678400) return t("window.monthly");
  if (seconds < 3600) return t("window.minutes", { n: Math.round(seconds / 60) });
  if (seconds < 86400) return t("window.hours", { n: Math.round(seconds / 3600) });
  return t("window.days", { n: Math.round(seconds / 86400) });
}

/** "2h 15m" - coarse on purpose, so a countdown does not jitter on a phone. */
export function durationText(t, ms) {
  if (!Number.isFinite(ms)) return null;
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return t("window.minutes", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${t("window.hours", { n: hours })} ${t("window.minutes", { n: rest })}` : t("window.hours", { n: hours });
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${t("window.days", { n: days })} ${t("window.hours", { n: rest })}` : t("window.days", { n: days });
}

export function meterLabel(t, meter, meterDef) {
  const def = meterDef || {};
  const byWindow = def.labelFrom === "window" && Number.isFinite(meter.window && meter.window.seconds);
  if (byWindow) return windowLabel(t, meter.window.seconds);
  return t(def.labelKey || `meter.${meter.meterKey}`);
}

export function clockText(iso, locale) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

/**
 * Live countdown. Recomputed on a client timer so it stays true between polls;
 * a window that has already turned over is reported by its wall clock instead
 * of as a negative duration.
 */
export function resetText(t, meter, now, locale) {
  const iso = meter.window && meter.window.resetAt;
  if (!iso) return { text: t("reset.unknown"), title: null };
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return { text: t("reset.unknown"), title: null };
  const title = clockText(iso, locale);
  if (ms - now <= 0) return { text: t("reset.at", { when: title }), title };
  return { text: t("reset.in", { duration: durationText(t, ms - now) }), title };
}

export function agoText(t, iso, now) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return durationText(t, Math.max(0, now - ms));
}

/** Note parameters are raw values; an ISO timestamp is unreadable as one. */
export function humaniseParams(params, locale) {
  if (!params) return undefined;
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)
      ? (clockText(value, locale) || value)
      : value;
  }
  return out;
}

export function severityOf(meter) {
  return SEVERITY[meter.state] === undefined ? 1 : SEVERITY[meter.state];
}

/** Worst-first, exactly as /api/summary orders it. */
export function worstMeter(meters) {
  let worst = null;
  for (const meter of meters) {
    if (!worst) { worst = meter; continue; }
    const a = severityOf(meter);
    const b = severityOf(worst);
    if (a > b) { worst = meter; continue; }
    if (a < b) continue;
    const ra = Number.isFinite(meter.usedRatio) ? meter.usedRatio : -1;
    const rb = Number.isFinite(worst.usedRatio) ? worst.usedRatio : -1;
    if (ra > rb || (ra === rb && String(meter.id) < String(worst.id))) worst = meter;
  }
  return worst;
}
