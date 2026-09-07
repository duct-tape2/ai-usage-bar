// Cursor plan usage.
//
// Cursor stores its own login in a local SQLite database that the editor
// writes; we read that token (read-only, never writing to the editor's state)
// and ask Cursor's dashboard endpoint about this account's current period.
//
// Cursor's remaining-quota numbers are the weakest in this whole category -
// other tools openly describe theirs as estimates. So this adapter reports
// exactly what the endpoint returns, marks anything it had to derive as an
// estimate, and never invents a total. If the response shape changes, it says
// schema_changed instead of showing a confident wrong number.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

function defaultStateDb() {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (process.platform === "win32") {
    return join(process.env.APPDATA || join(home, "AppData", "Roaming"), "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "Cursor", "User", "globalStorage", "state.vscdb");
}

function normalizeToken(raw) {
  let value = String(raw || "").trim();
  if (!value) return "";
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
  }
  value = String(value || "").trim();
  // A control character here means we read a binary blob, not a token.
  if (!value || /[\u0000-\u001f]/.test(value)) return "";
  return value;
}

async function readToken(ctx) {
  const stateDb = ctx.config.stateDb || defaultStateDb();
  if (!existsSync(stateDb)) throw Object.assign(new Error("Cursor state database not found"), { code: "not_installed" });

  const sqlite = await ctx.platform.findBinary(["sqlite3", "/usr/bin/sqlite3", "/opt/homebrew/bin/sqlite3"]);
  if (!sqlite) throw Object.assign(new Error("sqlite3 is required to read the Cursor login"), { code: "not_installed" });

  // Read-only, with a busy timeout: the editor may hold the database open and
  // we must never block or modify it.
  const { stdout } = await ctx.platform.runBinary(sqlite, [
    "-readonly", "-bail", `file:${stateDb}?mode=ro`, ".timeout 1000",
    "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken' LIMIT 1;",
  ], { timeoutMs: 6000, maxBuffer: 65_536 });

  const token = normalizeToken(stdout);
  if (!token) throw Object.assign(new Error("no Cursor login stored locally"), { code: "not_logged_in" });
  return token;
}

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

/** Cursor has renamed these fields more than once, so look under each spelling. */
function firstNumber(source, keys) {
  for (const key of keys) {
    const value = num(source?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function resetAt(source) {
  for (const key of ["billingCycleEnd", "cycleEnd", "periodEnd", "endDate", "resetAt"]) {
    const raw = source?.[key];
    if (!raw) continue;
    // Cursor sends epoch milliseconds as a decimal string.
    const asNumber = Number(raw);
    const ms = Number.isFinite(asNumber) && asNumber > 1e11
      ? (asNumber > 1e12 ? asNumber : asNumber * 1000)
      : Date.parse(raw);
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }
  return null;
}

export async function collect(ctx) {
  const token = await readToken(ctx);

  const payload = await ctx.http.postJson(USAGE_URL, {}, {
    headers: { authorization: `Bearer ${token}`, origin: "https://cursor.com" },
    timeoutMs: 12_000,
  });

  const plan = payload?.planUsage || {};
  const percentUsed = firstNumber(plan, ["totalPercentUsed", "usedPercent", "used_percent", "utilization"]);
  const reset = resetAt(payload) || resetAt(plan);

  // Cursor's spend figures are NOT a quota. On a real account this endpoint
  // returned totalSpend 129976 against limit 40000 while reporting 37% used -
  // the spend is the value delivered by the plan, not consumption of an
  // allowance. Dividing one by the other yields "324% used, exhausted", which
  // is both wrong and alarming, so the percentage Cursor itself publishes is
  // the meter, and the money is shown alongside it as context.
  if (percentUsed === null) {
    throw Object.assign(new Error("no percentage in the Cursor response"), { code: "schema_changed" });
  }

  const cents = (value) => (value === null ? null : value / 100);
  const spend = cents(firstNumber(plan, ["totalSpend", "total_spend"]));
  const included = cents(firstNumber(plan, ["includedSpend", "limit", "included_spend"]));

  const models = [];
  if (spend !== null) models.push({ nameKey: "cursor.spend", used: spend, unit: "currency", currency: "USD" });
  if (included !== null) models.push({ nameKey: "cursor.included", total: included, unit: "currency", currency: "USD" });

  return {
    meters: {
      plan: {
        unit: "percent",
        used: percentUsed,
        total: 100,
        // Cursor computes this itself, so the percentage is exact even though
        // what it measures is not documented.
        confidence: "exact",
        method: "cursor-dashboard",
        window: { kind: "calendar", seconds: 30 * 86400, resetAt: reset, resetSource: reset ? "reported" : "unknown" },
        detail: models.length ? { models, noteKey: "cursor.spendIsNotQuota" } : { noteKey: "cursor.spendIsNotQuota" },
      },
    },
  };
}
