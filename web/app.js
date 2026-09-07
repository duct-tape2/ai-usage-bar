// AI Usage Bar - dashboard entry point.
//
// One poll loop, one clock loop, one render. The page is meant to be opened on
// a phone over a private network, so it does the least work that keeps the
// numbers honest: a 30s poll, a coarse countdown, and nothing at all while the
// screen is off.

import { initTheme, getTheme, setTheme } from "./lib/theme.mjs";
import { resolveLang, loadStrings, makeTranslator } from "./lib/i18n.mjs";
import { getUsage, postRefresh } from "./lib/api.mjs";
import { renderBoard, tick, applyStaticStrings } from "./lib/render.mjs";
import { agoText } from "./lib/format.mjs";

// Before anything can await: the stored theme must land on <html> in the same
// task that the module runs, or the wrong palette gets a frame.
initTheme();

const POLL_MS = 30000;
const TICK_MS = 10000;

const dom = {
  updated: document.getElementById("updated"),
  banner: document.getElementById("banner"),
  hero: document.getElementById("hero"),
  heroBody: document.getElementById("hero-body"),
  grid: document.getElementById("providers"),
  empty: document.getElementById("empty"),
  refresh: document.getElementById("refresh"),
  themeToggle: document.getElementById("theme-toggle"),
};

const state = {
  t: (key) => key,
  locale: "en",
  signature: null,
  ticks: [],
  updatedAt: null,
  fetching: false,
  pollTimer: 0,
  tickTimer: 0,
};

/* ---------- chrome ---------- */

function syncThemeButtons() {
  const mode = getTheme();
  for (const button of dom.themeToggle.querySelectorAll("[data-theme-mode]")) {
    button.setAttribute("aria-pressed", String(button.getAttribute("data-theme-mode") === mode));
  }
}

function showBanner(text) {
  if (!text) {
    dom.banner.hidden = true;
    dom.banner.textContent = "";
    return;
  }
  dom.banner.textContent = text;
  dom.banner.hidden = false;
}

function providerNames(payload, ids) {
  const health = (payload.health && payload.health.providers) || {};
  const meta = payload.providerMeta || {};
  return ids.map((id) => (health[id] && health[id].displayName) || (meta[id] && meta[id].displayName) || id);
}

function healthBanner(payload) {
  const health = payload.health;
  if (!health || health.ok !== false) return null;
  const ids = [...new Set([...(health.failingProviders || []), ...(health.staleProviders || [])])];
  if (!ids.length) return null;
  return state.t("app.staleWarning", { providers: providerNames(payload, ids).join(", ") });
}

function paintUpdated(now = Date.now()) {
  if (!state.updatedAt) {
    dom.updated.textContent = "";
    return;
  }
  const ago = agoText(state.t, state.updatedAt, now);
  dom.updated.textContent = ago === null ? "" : state.t("app.lastUpdated", { ago });
}

/* ---------- render ---------- */

function signatureOf(payload) {
  return JSON.stringify({
    p: payload.providers || {},
    m: Object.keys(payload.providerMeta || {}),
  });
}

function paint(payload) {
  state.updatedAt = payload.updatedAt || null;

  const signature = signatureOf(payload);
  const changed = signature !== state.signature;
  state.signature = signature;

  if (changed) {
    const board = renderBoard({ t: state.t, locale: state.locale, now: Date.now(), payload });
    state.ticks = board.ticks;

    dom.grid.replaceChildren(board.grid);
    dom.heroBody.replaceChildren();
    if (board.hero) dom.heroBody.appendChild(board.hero);
    dom.hero.hidden = !board.hero;

    const empty = board.providerCount === 0;
    dom.empty.hidden = !empty;
    dom.grid.hidden = empty;
  }

  paintUpdated();
  showBanner(healthBanner(payload));
}

function runTick() {
  const now = Date.now();
  tick({ t: state.t, locale: state.locale, now, ticks: state.ticks });
  paintUpdated(now);
}

/* ---------- polling ---------- */

async function load() {
  if (state.fetching) return null;
  state.fetching = true;
  dom.grid.setAttribute("aria-busy", "true");
  try {
    const payload = await getUsage();
    paint(payload);
    return payload;
  } catch (error) {
    // Keep whatever is already on screen; only the banner tells the truth
    // about the fetch, because a stale number beats a blank page.
    showBanner(state.t(`error.${error && error.code ? error.code : "unknown"}`));
    return null;
  } finally {
    state.fetching = false;
    dom.grid.setAttribute("aria-busy", "false");
  }
}

function schedulePoll() {
  clearTimeout(state.pollTimer);
  state.pollTimer = setTimeout(async () => {
    if (!document.hidden) await load();
    schedulePoll();
  }, POLL_MS);
}

function scheduleTick() {
  clearInterval(state.tickTimer);
  state.tickTimer = setInterval(() => {
    if (!document.hidden) runTick();
  }, TICK_MS);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function manualRefresh() {
  if (dom.refresh.getAttribute("aria-busy") === "true") return;
  dom.refresh.setAttribute("aria-busy", "true");
  dom.refresh.disabled = true;
  const before = state.updatedAt;
  try {
    await postRefresh();
    // Collection is asynchronous on the daemon's side: read back a few times
    // rather than claiming a result the scheduler has not produced yet.
    for (const wait of [800, 2200, 4000]) {
      await sleep(wait);
      await load();
      if (state.updatedAt && state.updatedAt !== before) break;
    }
  } catch (error) {
    showBanner(state.t(`error.${error && error.code ? error.code : "unknown"}`));
  } finally {
    dom.refresh.disabled = false;
    dom.refresh.removeAttribute("aria-busy");
    schedulePoll();
  }
}

/* ---------- boot ---------- */

async function boot() {
  const lang = resolveLang();
  const { bundle, resolved } = await loadStrings(lang);
  state.t = makeTranslator(bundle);
  state.locale = resolved;

  document.documentElement.lang = resolved;
  document.title = state.t("app.title");
  applyStaticStrings(state.t);
  syncThemeButtons();

  dom.themeToggle.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-mode]");
    if (!button) return;
    setTheme(button.getAttribute("data-theme-mode"));
    syncThemeButtons();
  });

  dom.refresh.addEventListener("click", manualRefresh);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    runTick();
    load();
    schedulePoll();
  });

  await load();
  schedulePoll();
  scheduleTick();
}

boot();
