// Demo fixture snapshot showing realistic meters without requiring any credentials.

export function createDemoSnapshot() {
  const now = new Date().toISOString();
  const nextWeekResetAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const nextMonthResetAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

  return {
    v: 1,
    updatedAt: now,
    providers: {
      codex: {
        providerId: "codex",
        meters: [
          {
            id: "codex.primary",
            providerId: "codex",
            meterKey: "primary",
            unit: "percent",
            used: 1,
            total: 100,
            confidence: "exact",
            source: { tier: "local-file", adapter: "codex" },
            window: { kind: "calendar", seconds: 604800, resetAt: nextWeekResetAt },
            capturedAt: now,
            receivedAt: now,
          },
        ],
        capturedAt: now,
        receivedAt: now,
        error: null,
      },
      "claude-code": {
        providerId: "claude-code",
        meters: [
          {
            id: "claude-code.primary",
            providerId: "claude-code",
            meterKey: "primary",
            unit: "percent",
            used: 28,
            total: 100,
            confidence: "exact",
            source: { tier: "vendor-api", adapter: "claude-code" },
            window: { kind: "calendar", seconds: 604800, resetAt: nextWeekResetAt },
            capturedAt: now,
            receivedAt: now,
          },
        ],
        capturedAt: now,
        receivedAt: now,
        error: null,
      },
      cursor: {
        providerId: "cursor",
        meters: [
          {
            id: "cursor.plan",
            providerId: "cursor",
            meterKey: "plan",
            unit: "percent",
            used: 37,
            total: 100,
            confidence: "exact",
            source: { tier: "vendor-api", adapter: "cursor" },
            window: { kind: "rolling", seconds: 2592000, resetAt: nextMonthResetAt },
            capturedAt: now,
            receivedAt: now,
          },
        ],
        capturedAt: now,
        receivedAt: now,
        error: null,
      },
      "chatgpt-pro": {
        providerId: "chatgpt-pro",
        meters: [
          {
            id: "chatgpt-pro.proWeekly",
            providerId: "chatgpt-pro",
            meterKey: "proWeekly",
            unit: "percent",
            used: 65,
            total: 100,
            confidence: "estimate",
            source: { tier: "session-scrape", adapter: "chatgpt-pro" },
            window: { kind: "calendar", seconds: 604800, resetAt: nextWeekResetAt },
            capturedAt: now,
            receivedAt: now,
          },
        ],
        capturedAt: now,
        receivedAt: now,
        error: null,
      },
    },
  };
}
