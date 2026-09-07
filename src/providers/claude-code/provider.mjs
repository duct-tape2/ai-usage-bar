import { collect } from "./collect.mjs";

export default {
  id: "claude-code",
  displayName: "Claude",
  // The vendor's own API, for the signed-in account, using the credential the
  // vendor's CLI already stored here. Undocumented, hence vendor-api and not
  // official-api.
  tier: "vendor-api",
  platforms: ["darwin", "linux", "win32"],
  docUrl: "https://docs.claude.com/en/docs/claude-code",
  requires: { secrets: [], bin: [] },

  schedule: { intervalSeconds: 180, timeoutSeconds: 20 },
  group: { key: "anthropic", labelKey: "group.anthropic", order: 20, icon: "anthropic" },

  meters: {
    fiveHour: { labelKey: "meter.session", order: 0, unit: "percent", confidence: "exact", dynamic: true },
    sevenDay: { labelKey: "meter.primaryWindow", order: 1, unit: "percent", confidence: "exact", dynamic: true },
    sevenDayOpus: { labelKey: "meter.opusWindow", order: 2, unit: "percent", confidence: "exact", dynamic: true },
    sevenDaySonnet: { labelKey: "meter.sonnetWindow", order: 3, unit: "percent", confidence: "exact", dynamic: true },
    extraUsage: { labelKey: "meter.extraUsage", order: 4, unit: "currency", currency: "USD", dynamic: true },
  },

  config: {
    claudeHome: { type: "string", default: null, descKey: "cfg.claudeHome" },
    credentialsFile: { type: "string", default: null, descKey: "cfg.credentialsFile" },
  },

  collect,
};
