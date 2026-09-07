// Three-state theme: auto follows the OS, light and dark pin it.
//
// "auto" removes the attribute entirely, which is why the stylesheet guards
// its dark media block with :root:not([data-theme="light"]) - the OS answer is
// the default, and CSS applies it before this module ever runs.

const STORE_KEY = "aub.theme";
const MODES = ["auto", "light", "dark"];

function read() {
  let stored = null;
  try { stored = localStorage.getItem(STORE_KEY); } catch { stored = null; }
  return MODES.includes(stored) ? stored : "auto";
}

function apply(mode) {
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

let current = "auto";

/** Called at the top of app.js, before any await, to keep the wrong theme off screen. */
export function initTheme() {
  current = read();
  apply(current);
  return current;
}

export function getTheme() {
  return current;
}

export function setTheme(mode) {
  current = MODES.includes(mode) ? mode : "auto";
  apply(current);
  try { localStorage.setItem(STORE_KEY, current); } catch { /* private mode */ }
  return current;
}
