import { collect } from "./collect.mjs";

export default {
  id: "codex",
  displayName: "Codex",
  // Reads a file the vendor's own CLI wrote on this machine. No network, no
  // credentials, nothing to rate-limit.
  tier: "local-file",
  platforms: ["darwin", "linux", "win32"],
  docUrl: "https://developers.openai.com/codex/cli",
  requires: { secrets: [], bin: [] },

  schedule: { intervalSeconds: 120, timeoutSeconds: 20 },
  group: { key: "openai", labelKey: "group.openai", order: 10, icon: "openai" },

  meters: {
    primary: { labelKey: "meter.primaryWindow", labelFrom: "window", order: 0, unit: "percent", confidence: "exact" },
    secondary: { labelKey: "meter.secondaryWindow", labelFrom: "window", order: 1, unit: "percent", confidence: "exact", dynamic: true },
    credits: { labelKey: "meter.credits", order: 2, unit: "currency", currency: "USD", dynamic: true },
  },

  config: {
    codexHome: { type: "string", default: null, descKey: "cfg.codexHome" },
    sessionsDir: { type: "string", default: null, descKey: "cfg.sessionsDir" },
  },

  collect,
};
