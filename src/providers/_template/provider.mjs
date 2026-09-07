// Copy this directory to ~/.config/ai-usage-bar/providers/<your-id>/ and edit.
// See docs/adapter-sdk.md. The directory name must match `id`.

import { collect } from "./collect.mjs";

export default {
  id: "example",
  displayName: "Example",

  // The riskiest route this adapter can take. Users gate on this - be honest.
  tier: "official-api",

  platforms: ["darwin", "linux", "win32"],
  docUrl: "https://example.com/docs/usage",
  requires: { secrets: ["apiKey"], bin: [] },

  // 60 seconds is a hard floor enforced at load time.
  schedule: { intervalSeconds: 300, timeoutSeconds: 20 },

  group: { key: "example", labelKey: "group.example", order: 90 },

  meters: {
    // `dynamic: true` means "only show this when the provider reports it".
    credits: { labelKey: "meter.credits", order: 0, unit: "currency", currency: "USD" },
  },

  // Anything a user might reasonably want to change belongs here, not in code.
  config: {
    apiKey: { type: "string", default: null, descKey: "cfg.apiKey" },
  },

  collect,
};
