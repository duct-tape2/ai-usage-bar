import { collect } from "./collect.mjs";

export default {
  id: "chatgpt-pro",
  displayName: "ChatGPT Pro",

  // Uses the session your browser already holds against ChatGPT's own private
  // web API, for your account only. That is a real risk to your account, not a
  // theoretical one, so this provider is OFF until you turn it on. Read
  // RISKS.md first. Refreshing the session evaluates one expression in a
  // chatgpt.com tab you already have open - it never navigates or reloads.
  tier: "session-scrape",

  platforms: ["darwin", "linux", "win32"],
  platformNotes: { linux: "set tokenSource to manual - no browser automation off macOS" },
  requires: { secrets: ["session"], bin: [] },

  // One small JSON request per cycle. The floor is 60s and this stays well
  // above it on purpose.
  schedule: { intervalSeconds: 120, timeoutSeconds: 60, staleAfterSeconds: 420 },
  group: { key: "openai", labelKey: "group.openai", order: 0, icon: "openai", hero: true },

  meters: {
    proWeekly: {
      labelKey: "meter.proWeekly",
      order: 0,
      unit: "count",
      totalFrom: "config.weeklyTotal",
      confidence: "lower-bound",
      window: { kind: "rolling" },
    },
  },

  config: {
    weeklyTotal: { type: "number", default: 200, descKey: "cfg.weeklyTotal" },
    windowDays: { type: "number", default: 7, descKey: "cfg.windowDays" },
    proSlugs: { type: "string[]", default: ["gpt-6-pro"], descKey: "cfg.proSlugs" },
    tokenSource: { type: "string", default: "auto", descKey: "cfg.tokenSource" },
  },

  collect,
};
