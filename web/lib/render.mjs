// DOM construction.
//
// No innerHTML anywhere: every value from the daemon reaches the page as a
// text node. The CSP forbids inline styles, so the only per-element styling is
// a CSS custom property set through the CSSOM.

import {
  remainingText, remainingRatio, meterLabel, resetText, agoText,
  humaniseParams, worstMeter, formatNumber, formatCurrency,
} from "./format.mjs";

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  if (children) for (const child of children) if (child) node.appendChild(child);
  return node;
}

function tierChip(ctx, meter) {
  const tier = meter.source && meter.source.tier;
  if (!tier) return null;
  const label = ctx.t(`tier.${tier}`);
  const explain = ctx.t("tier.explain");
  const docUrl = (meter.source && meter.source.docUrl) || null;
  if (!docUrl) {
    return el("span", { class: "chip chip--tier", title: explain, text: label });
  }
  return el("a", {
    class: "chip chip--tier",
    href: docUrl,
    target: "_blank",
    rel: "noopener noreferrer",
    title: explain,
    "aria-label": `${label} - ${explain}`,
    text: label,
  });
}

function bar(ctx, meter, { hero = false, label }) {
  const ratio = remainingRatio(meter);
  const exact = !meter.confidence || meter.confidence === "exact";
  const classes = ["bar"];
  if (!exact) classes.push("bar--approx");
  if (ratio === null) classes.push("bar--empty");

  const track = el("div", {
    class: classes.join(" "),
    role: "progressbar",
    "aria-label": label,
    "aria-valuemin": "0",
    "aria-valuemax": "100",
    "aria-valuetext": remainingText(meter, ctx.locale),
  });
  if (ratio !== null) track.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));

  const fill = el("span", { class: "bar__fill" });
  // CSSOM, not an inline style attribute: the CSP allows this, and it keeps
  // the width animatable from the stylesheet.
  fill.style.setProperty("--fill", `${((ratio === null ? 0 : ratio) * 100).toFixed(2)}%`);
  track.appendChild(fill);
  if (hero) track.setAttribute("data-hero", "true");
  return track;
}

function flags(ctx, meter) {
  const out = [];
  const confidence = meter.confidence;
  if (confidence && confidence !== "exact") {
    out.push(el("span", { class: "chip chip--approx", text: ctx.t(`confidence.${confidence}`) }));
  }
  if (meter.stale) {
    out.push(el("span", { class: "chip chip--flag", "data-state": "stale", text: ctx.t("state.stale") }));
  }
  if (meter.error) {
    out.push(el("span", { class: "chip chip--error", text: ctx.t(`error.${meter.error}`) }));
  }
  return out;
}

function resetLine(ctx, meter) {
  const info = resetText(ctx.t, meter, ctx.now, ctx.locale);
  const node = el("span", { class: "reset", text: info.text });
  if (info.title) node.setAttribute("title", info.title);
  ctx.ticks.push({ node, kind: "reset", meter });
  return node;
}

/** A breakdown line: a named sub-figure that is context, never the headline. */
function factValue(ctx, fact) {
  const currency = fact.unit === "currency";
  const one = (value) => (currency
    ? formatCurrency(value, fact.currency, ctx.locale)
    : formatNumber(value, ctx.locale));

  if (Number.isFinite(fact.used) && Number.isFinite(fact.total)) return `${one(fact.used)}/${one(fact.total)}`;
  for (const key of ["used", "remaining", "total", "value"]) {
    if (Number.isFinite(fact[key])) return one(fact[key]);
  }
  return "-";
}

function factName(ctx, fact) {
  if (typeof fact === "string") return fact;
  if (fact.nameKey) return ctx.t(fact.nameKey);
  return fact.name || fact.id || "";
}

function noteNodes(ctx, meter) {
  const out = [];
  const detail = meter.detail || {};

  const models = Array.isArray(detail.models) ? detail.models : [];
  if (models.length) {
    out.push(el("ul", { class: "facts" }, models.map((fact) => {
      const name = factName(ctx, fact);
      if (typeof fact === "string") return el("li", { class: "fact" }, [el("span", { class: "fact__key", text: name })]);
      return el("li", { class: "fact" }, [
        el("span", { class: "fact__key", text: name }),
        el("span", { class: "fact__val", text: factValue(ctx, fact) }),
      ]);
    })));
  }

  if (detail.noteKey) {
    out.push(el("p", {
      class: "meter__note",
      text: ctx.t(detail.noteKey, humaniseParams(detail.noteParams, ctx.locale)),
    }));
  }
  return out;
}

/** Rendered only once the caption key exists; a raw key here would shout. */
function unitCaption(ctx, className) {
  if (!ctx.t.has || !ctx.t.has("app.left")) return null;
  return el("span", { class: className, text: ctx.t("app.left") });
}

function stateBadge(ctx, state) {
  return el("span", { class: "state", text: ctx.t(`state.${state || "unknown"}`) });
}

function meterRow(ctx, meter, meterDef, providerName) {
  const label = meterLabel(ctx.t, meter, meterDef);
  const state = meter.state || "unknown";
  const exact = !meter.confidence || meter.confidence === "exact";

  const value = el("span", {
    class: exact ? "meter__value" : "meter__value value--approx",
    text: remainingText(meter, ctx.locale),
  });

  return el("li", { class: "meter", "data-state": state }, [
    el("div", { class: "meter__top" }, [
      el("span", { class: "meter__label", text: label }),
      stateBadge(ctx, state),
    ]),
    el("p", { class: "meter__figure" }, [
      value,
      unitCaption(ctx, "meter__unit"),
    ]),
    bar(ctx, meter, { label: `${providerName} ${label}` }),
    el("div", { class: "meter__foot" }, [
      tierChip(ctx, meter),
      ...flags(ctx, meter),
      resetLine(ctx, meter),
    ]),
    ...noteNodes(ctx, meter),
  ]);
}

/** A provider that answered with nothing still gets a row, never a blank card. */
function providerErrorRow(ctx, code, tier) {
  const chips = [];
  if (tier) chips.push(el("span", { class: "chip chip--tier", title: ctx.t("tier.explain"), text: ctx.t(`tier.${tier}`) }));
  chips.push(el("span", { class: "chip chip--error", text: ctx.t(`error.${code || "unknown"}`) }));

  return el("li", { class: "meter", "data-state": "unknown" }, [
    el("div", { class: "meter__top" }, [
      el("span", { class: "meter__label" }),
      stateBadge(ctx, "unknown"),
    ]),
    el("p", { class: "meter__figure" }, [
      el("span", { class: "meter__value", text: "-" }),
      unitCaption(ctx, "meter__unit"),
    ]),
    el("div", { class: "bar bar--empty" }),
    el("div", { class: "meter__foot" }, chips),
  ]);
}

function providerCard(ctx, providerId, meta, entry) {
  const displayName = (meta && meta.displayName) || providerId;
  const rawGroup = meta && meta.group && meta.group.labelKey ? ctx.t(meta.group.labelKey) : null;
  // A vendor whose group is its own name ("Cursor" / "Cursor") does not need
  // the line twice.
  const groupLabel = rawGroup && rawGroup.toLowerCase() !== String(displayName).toLowerCase() ? rawGroup : null;
  const meters = ((entry && entry.meters) || []).slice().sort((a, b) => {
    const oa = (meta && meta.meters && meta.meters[a.meterKey] && meta.meters[a.meterKey].order) || 0;
    const ob = (meta && meta.meters && meta.meters[b.meterKey] && meta.meters[b.meterKey].order) || 0;
    return oa - ob || String(a.meterKey).localeCompare(String(b.meterKey));
  });

  const headId = `provider-${providerId}`;
  const rows = meters.length
    ? meters.map((meter) => meterRow(ctx, meter, meta && meta.meters ? meta.meters[meter.meterKey] : null, displayName))
    : [providerErrorRow(ctx, (entry && entry.error) || "no_data", meta && meta.tier)];

  const age = entry && entry.capturedAt ? agoText(ctx.t, entry.capturedAt, ctx.now) : null;
  const ageNode = age === null ? null : el("p", { class: "card__age", text: ctx.t("app.lastUpdated", { ago: age }) });
  if (ageNode) ctx.ticks.push({ node: ageNode, kind: "ago", iso: entry.capturedAt });

  return el("article", { class: "card", "aria-labelledby": headId }, [
    el("div", { class: "card__head" }, [
      el("div", { class: "card__id" }, [
        groupLabel ? el("p", { class: "card__group", text: groupLabel }) : null,
        el("h3", { class: "card__name", id: headId, text: displayName }),
      ]),
      ageNode,
    ]),
    el("ul", { class: "card__meters" }, rows),
  ]);
}

function heroCard(ctx, meter, meta) {
  const displayName = (meta && meta.displayName) || meter.providerId;
  const meterDef = meta && meta.meters ? meta.meters[meter.meterKey] : null;
  const label = meterLabel(ctx.t, meter, meterDef);
  const state = meter.state || "unknown";
  const exact = !meter.confidence || meter.confidence === "exact";

  return el("div", { class: "hero__card", "data-state": state }, [
    el("div", { class: "hero__top" }, [
      el("p", { class: "hero__label", text: `${displayName} ${label}` }),
      stateBadge(ctx, state),
    ]),
    el("p", { class: "hero__figure" }, [
      el("span", { class: exact ? "hero__value" : "hero__value value--approx", text: remainingText(meter, ctx.locale) }),
      unitCaption(ctx, "hero__unit"),
    ]),
    bar(ctx, meter, { hero: true, label: `${displayName} ${label}` }),
    el("div", { class: "meter__foot" }, [
      tierChip(ctx, meter),
      ...flags(ctx, meter),
      resetLine(ctx, meter),
    ]),
    ...noteNodes(ctx, meter),
  ]);
}

/**
 * Builds the whole board from one payload. Returns the fragments plus the list
 * of nodes the countdown timer owns, so app.js can keep clocks live without
 * re-rendering the DOM every second.
 */
export function renderBoard({ t, locale, now, payload }) {
  const ctx = { t, locale, now, ticks: [] };
  const providerMeta = payload.providerMeta || {};
  const providers = payload.providers || {};

  const ids = Array.from(new Set([...Object.keys(providerMeta), ...Object.keys(providers)]));
  ids.sort((a, b) => {
    const ga = (providerMeta[a] && providerMeta[a].group && providerMeta[a].group.order) || 500;
    const gb = (providerMeta[b] && providerMeta[b].group && providerMeta[b].group.order) || 500;
    if (ga !== gb) return ga - gb;
    const na = (providerMeta[a] && providerMeta[a].displayName) || a;
    const nb = (providerMeta[b] && providerMeta[b].displayName) || b;
    return String(na).localeCompare(String(nb));
  });

  const grid = document.createDocumentFragment();
  const allMeters = [];
  for (const id of ids) {
    const entry = providers[id] || null;
    if (entry && Array.isArray(entry.meters)) allMeters.push(...entry.meters);
    grid.appendChild(providerCard(ctx, id, providerMeta[id], entry));
  }

  const worst = worstMeter(allMeters);
  const hero = worst ? heroCard(ctx, worst, providerMeta[worst.providerId]) : null;

  return { grid, hero, ticks: ctx.ticks, providerCount: ids.length, meterCount: allMeters.length };
}

/** Re-time the clocks in place. Cheap enough to run while the screen is on. */
export function tick({ t, locale, now, ticks }) {
  for (const item of ticks) {
    if (!item.node.isConnected) continue;
    if (item.kind === "reset") {
      const info = resetText(t, item.meter, now, locale);
      if (item.node.textContent !== info.text) item.node.textContent = info.text;
    } else if (item.kind === "ago") {
      const ago = agoText(t, item.iso, now);
      if (ago !== null) {
        const text = t("app.lastUpdated", { ago });
        if (item.node.textContent !== text) item.node.textContent = text;
      }
    }
  }
}

export function applyStaticStrings(t) {
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.getAttribute("data-i18n"));
  }
  for (const node of document.querySelectorAll("[data-i18n-label]")) {
    node.setAttribute("aria-label", t(node.getAttribute("data-i18n-label")));
  }
  for (const node of document.querySelectorAll("[data-i18n-title]")) {
    node.setAttribute("title", t(node.getAttribute("data-i18n-title")));
  }
}
