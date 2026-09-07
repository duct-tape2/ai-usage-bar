// Language resolution and string lookup.
//
// The API deliberately returns keys and numbers, never prose, so every visible
// string on this page comes from a bundle fetched at /api/i18n/<lang>. A key
// that no bundle answers renders as the key itself - loud enough to be found
// and fixed, quiet enough not to lie.

const STORE_KEY = "aub.lang";
const FALLBACK = "en";
const TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

/** ?lang -> localStorage -> navigator.languages -> en. */
export function resolveLang(search = location.search) {
  const wanted = [];
  const requested = new URLSearchParams(search).get("lang");
  if (requested) wanted.push(requested);
  const stored = read(STORE_KEY);
  if (stored) wanted.push(stored);
  for (const nav of navigator.languages || [navigator.language]) if (nav) wanted.push(nav);
  wanted.push(FALLBACK);

  for (const raw of wanted) {
    const tag = String(raw).trim().toLowerCase();
    if (TAG.test(tag)) {
      if (requested && tag === String(requested).trim().toLowerCase()) write(STORE_KEY, tag);
      return tag;
    }
  }
  return FALLBACK;
}

async function fetchBundle(lang) {
  try {
    const res = await fetch(`/api/i18n/${encodeURIComponent(lang)}`, { cache: "no-store" });
    if (!res.ok) return null;
    const body = await res.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Loads the requested bundle over the fallback one, so a partial translation
 * degrades to English rather than to raw keys.
 */
export async function loadStrings(lang) {
  const base = lang.split("-")[0];
  const [fallback, exact, generic] = await Promise.all([
    lang === FALLBACK ? Promise.resolve(null) : fetchBundle(FALLBACK),
    fetchBundle(lang),
    base !== lang ? fetchBundle(base) : Promise.resolve(null),
  ]);
  const bundle = { ...(fallback || {}), ...(generic || {}), ...(exact || {}) };
  const resolved = exact || generic ? lang : (fallback ? FALLBACK : lang);
  return { bundle, resolved };
}

export function makeTranslator(bundle) {
  const has = (key) => Object.prototype.hasOwnProperty.call(bundle, key);

  function t(key, params) {
    const template = has(key) ? bundle[key] : key;
    if (!params) return template;
    return String(template).replace(/\{(\w+)\}/g, (whole, name) => (
      params[name] === undefined ? whole : String(params[name])
    ));
  }

  // Optional adornments (a caption next to a figure, say) ask before they
  // render: a raw key shouted next to every number is worse than no caption.
  // Anything load-bearing still falls back to the key, where it is findable.
  t.has = has;
  return t;
}
