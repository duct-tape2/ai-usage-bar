// ChatGPT Pro weekly message allowance.
//
// This is the number nobody else shows you. OpenAI publishes no endpoint for
// it - not in the settings Usage panel, which covers Codex and Work rather
// than chat, and not in /backend-api/models. So it has to be counted.
//
// How: read your own conversation list, and for conversations that changed,
// count the assistant responses whose model slug is a Pro model, attributed
// to the user turn that asked for them. Because that reads the account's
// server-side history rather than this machine's browser, Pro usage from your
// phone or another computer is counted too.
//
// What it costs: one small JSON request per cycle, plus a detail read only for
// conversations that actually changed - usually none. An earlier private
// version of this reloaded the ChatGPT web app four times every fifteen
// seconds and earned an "accessing too frequently" warning; that is the
// mistake this design exists to avoid.
//
// Honesty: the count is a LOWER BOUND. Archived, deleted and temporary chats
// are not in the history, so they cannot be counted. The card says so.

const ORIGIN = "https://chatgpt.com";
const LIST_LIMIT = 28;
const MAX_LIST_PAGES = 8;
const MAX_DETAIL_PER_CYCLE = 6;
const DETAIL_GAP_MS = 700;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Kept as a plain function so the identical source can run inside a browser tab. */
function reduceList(json) {
  return (json.items || [])
    .map((item) => ({ id: item.id, u: item.update_time || item.create_time || null }))
    .filter((item) => typeof item.id === "string" && item.id.length > 10);
}

/**
 * Collapses a Pro answer to the request that caused it. One reply can span
 * several assistant nodes (thinking, tool calls, final text); charging the
 * quota once per user turn is what matches how the allowance is actually
 * spent.
 */
export function reduceConversation(json, proSlugs) {
  const mapping = (json && json.mapping) || {};
  const timeOf = (node) => {
    const message = node && node.message;
    if (!message) return null;
    if (typeof message.create_time === "number") return message.create_time * 1000;
    const parsed = Date.parse(message.create_time || "");
    return Number.isFinite(parsed) ? parsed : null;
  };

  const turns = {};
  for (const id of Object.keys(mapping)) {
    const node = mapping[id];
    const message = node && node.message;
    if (!message || !message.author || message.author.role !== "assistant") continue;
    const slug = (message.metadata && message.metadata.model_slug) || "";
    if (proSlugs.indexOf(slug) === -1) continue;

    // An agentic Pro turn can put well over a hundred tool and thought nodes
    // between the answer and the question that asked for it, so the walk up
    // is bounded by a visited set rather than a hop count. A hop count silently
    // turned every deep node into its own "request" and inflated the week by
    // 10x on real conversations. A node with no user ancestor is not a
    // request and is skipped.
    let key = null;
    let when = timeOf(node);
    let cursor = node;
    const seen = new Set();
    while (cursor && cursor.parent && !seen.has(cursor.parent)) {
      seen.add(cursor.parent);
      const parent = mapping[cursor.parent];
      if (!parent) break;
      const parentMessage = parent.message;
      if (parentMessage && parentMessage.author && parentMessage.author.role === "user") {
        key = parent.id || cursor.parent;
        when = timeOf(parent) || when;
        break;
      }
      cursor = parent;
    }
    if (!key || !when) continue;
    if (!turns[key] || when < turns[key]) turns[key] = when;
  }
  return Object.keys(turns).map((key) => [key, turns[key]]);
}

/**
 * Reads the session the browser already holds, by evaluating one expression in
 * a chatgpt.com tab that is already open. It never navigates, reloads or
 * focuses anything, and it is needed roughly once every few months.
 */
async function refreshToken(ctx) {
  if (!ctx.platform?.automation?.available) {
    throw Object.assign(new Error("no stored session and no browser to read one from"), { code: "auth_missing" });
  }
  const session = await ctx.platform.automation.evalInTab(
    "^https://chatgpt\\.com/",
    `async () => {
      const r = await fetch("/api/auth/session", { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("session-http-" + r.status);
      const j = await r.json();
      if (!j || !j.accessToken) throw new Error("session-no-token");
      return { accessToken: j.accessToken, expires: j.expires || null };
    }`,
  );
  await ctx.secrets.set("session", session.accessToken, { expires: session.expires });
  return session.accessToken;
}

async function getToken(ctx, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const stored = await ctx.secrets.get("session");
    if (stored) {
      const meta = await ctx.secrets.meta("session");
      const expires = Date.parse(meta?.expires || "");
      if (!Number.isFinite(expires) || expires - Date.now() > 12 * 3600_000) return stored;
    }
  }
  if (ctx.config.tokenSource === "manual") {
    throw Object.assign(new Error("stored session is missing or expiring"), { code: "auth_expired" });
  }
  return refreshToken(ctx);
}

// The session token belongs to a browser session, and OpenAI's edge answers a
// non-browser User-Agent with an HTML challenge page (which this project
// classifies as rate limiting). Present the request the way the browser that
// owns the token would, on this adapter only.
const BROWSER_HEADERS = {
  accept: "application/json",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
};

function api(ctx, token, path) {
  return ctx.http.getJson(ORIGIN + path, {
    headers: { ...BROWSER_HEADERS, authorization: `Bearer ${token}`, referer: `${ORIGIN}/` },
    timeoutMs: 20_000,
  });
}

export async function collect(ctx) {
  const proSlugs = Array.isArray(ctx.config.proSlugs) && ctx.config.proSlugs.length
    ? ctx.config.proSlugs
    : ["gpt-6-pro"];
  const windowDays = Number(ctx.config.windowDays) > 0 ? Number(ctx.config.windowDays) : 7;
  const windowMs = windowDays * 86400_000;

  let token = await getToken(ctx);
  const state = await ctx.state.read();
  const conversations = state.conversations && typeof state.conversations === "object" ? state.conversations : {};
  const pending = new Set(Array.isArray(state.pending) ? state.pending : []);

  const now = ctx.now();
  const windowStart = now - windowMs;
  // A little slack so a conversation that changed just before the window
  // opened is still examined.
  const scanFloor = windowStart - 3 * 86400_000;

  const request = async (path) => {
    try {
      return await api(ctx, token, path);
    } catch (error) {
      if (error?.code !== "auth_expired") throw error;
      token = await getToken(ctx, { forceRefresh: true });
      return api(ctx, token, path);
    }
  };

  // The list is ordered by update time, so one page catches anything new; the
  // deeper walk only has to happen occasionally.
  const lastFullWalk = Number(state.lastFullWalkAt) || 0;
  const fullWalk = now - lastFullWalk > 30 * 60_000;
  const listed = [];
  for (let page = 0; page < (fullWalk ? MAX_LIST_PAGES : 1); page++) {
    const items = reduceList(await request(`/backend-api/conversations?offset=${page * LIST_LIMIT}&limit=${LIST_LIMIT}&order=updated`));
    if (!items.length) break;
    listed.push(...items);
    const oldest = Date.parse(items[items.length - 1].u || "");
    if (!Number.isFinite(oldest) || oldest < scanFloor) break;
    await sleep(400);
  }
  if (!listed.length) throw Object.assign(new Error("empty conversation list"), { code: "no_data" });

  for (const item of listed) {
    const known = conversations[item.id];
    const updated = Date.parse(item.u || "") || 0;
    if (updated < scanFloor && known) continue;
    if (!fullWalk && !known && updated < scanFloor) continue;
    if (!known || (known.u || 0) < updated) pending.add(item.id);
  }

  // Bounded detail reads; whatever is left carries over to the next cycle.
  let scanned = 0;
  for (const id of [...pending].slice(0, MAX_DETAIL_PER_CYCLE)) {
    const item = listed.find((entry) => entry.id === id);
    try {
      const turns = reduceConversation(await request(`/backend-api/conversation/${id}`), proSlugs);
      conversations[id] = { u: Date.parse(item?.u || "") || now, t: turns };
      scanned += 1;
    } catch (error) {
      if (error?.code === "rate_limited") throw error;
      // One unreadable conversation must not stall the queue forever.
    }
    pending.delete(id);
    await sleep(DETAIL_GAP_MS);
  }

  // Forget conversations that fell out of the retained window.
  for (const id of Object.keys(conversations)) {
    const entry = conversations[id];
    if (!(entry.t || []).length && (entry.u || 0) < windowStart - 30 * 86400_000) delete conversations[id];
  }

  let used = 0;
  let total = 0;
  for (const entry of Object.values(conversations)) {
    for (const [, when] of entry.t || []) {
      total += 1;
      if (when >= windowStart) used += 1;
    }
  }

  await ctx.state.write({
    conversations,
    pending: [...pending],
    lastFullWalkAt: fullWalk ? now : lastFullWalk,
    lastSuccessAt: new Date(now).toISOString(),
  });

  return {
    meters: {
      proWeekly: {
        unit: "count",
        used,
        // total comes from config: the published allowance changes, and a
        // constant in code would be wrong for anyone on a different plan.
        confidence: "lower-bound",
        method: "account-history-count",
        window: { kind: "rolling", seconds: windowDays * 86400, resetSource: "unknown" },
        detail: {
          noteKey: "chatgptPro.coverage",
          noteParams: { scanned, tracked: Object.keys(conversations).length, cumulative: total },
        },
      },
    },
  };
}
