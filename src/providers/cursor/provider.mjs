import { collect } from "./collect.mjs";

export default {
  id: "cursor",
  displayName: "Cursor",
  // Reads the login Cursor stored on this machine, then asks Cursor's own
  // dashboard endpoint about this account. Undocumented, hence vendor-api.
  tier: "vendor-api",
  platforms: ["darwin", "linux", "win32"],
  docUrl: "https://cursor.com/dashboard",
  requires: { secrets: [], bin: ["sqlite3"] },

  schedule: { intervalSeconds: 300, timeoutSeconds: 25 },
  group: { key: "cursor", labelKey: "group.cursor", order: 30, icon: "cursor" },

  meters: {
    plan: { labelKey: "meter.plan", order: 0 },
  },

  config: {
    stateDb: { type: "string", default: null, descKey: "cfg.cursorStateDb" },
  },

  collect,
};
