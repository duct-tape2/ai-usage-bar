# Writing a provider adapter

An adapter answers one question: **how much is left?** Everything else — HTTP,
timeouts, retries, timestamps, id namespacing, translation, error handling, storage
— belongs to the core and is not your problem.

A working adapter is about thirty lines.

## The whole contract

```js
// ~/.config/ai-usage-bar/providers/openrouter/collect.mjs
export async function collect(ctx) {
  const key = await ctx.secrets.get("apiKey");
  const data = await ctx.http.getJson("https://openrouter.ai/api/v1/credits", {
    headers: { authorization: `Bearer ${key}` },
    timeoutMs: 8000,
  });

  return {
    meters: {
      credits: {
        used: data.total_usage,
        total: data.total_credits,
        unit: "currency",
        currency: "USD",
        confidence: "exact",
      },
    },
  };
}
```

```js
// ~/.config/ai-usage-bar/providers/openrouter/provider.mjs
import { collect } from "./collect.mjs";

export default {
  id: "openrouter",
  displayName: "OpenRouter",
  tier: "official-api",
  schedule: { intervalSeconds: 300 },
  group: { key: "openrouter", labelKey: "group.openrouter", order: 60 },
  meters: {
    credits: { labelKey: "meter.credits", order: 0, unit: "currency", currency: "USD" },
  },
  config: {
    apiKey: { type: "string", default: null, descKey: "cfg.apiKey" },
  },
  collect,
};
```

Then enable it:

```json
{ "providers": { "openrouter": { "enabled": true } } }
```

External adapters load **only** when named in your config. Discovery alone never
executes a stranger's module.

## What you may return

Report what the provider actually told you. Do not compute what you can leave out —
the core derives `remaining` from `used` and `total`, `usedRatio` from either, and
`used` from `remaining` and `total`.

| Field | When to set it |
|---|---|
| `unit` | `percent` (0..100), `count`, `currency`, `tokens`, `boolean` |
| `used` / `total` / `remaining` | Whichever the provider gives you. One is enough |
| `usedRatio` | Only if the provider reports a ratio directly |
| `currency` | Required with `unit: "currency"` |
| `window` | `{ kind, seconds, resetAt }`. Omit `resetAt` rather than inventing one |
| `confidence` | `exact`, `lower-bound`, or `estimate`. Be honest — the UI renders these differently |
| `tier` | Only if this meter used a *different* route than the manifest's tier |
| `detail` | `{ models: [...], noteKey, noteParams }`. Structured values only |

**Never return prose.** No labels, no explanations, no units spelled out in words.
The API contract is that human text comes from locale files, and a test fails the
build if adapter output contains non-key text.

## Failing well

Throw. The core turns it into a typed code, keeps your last known numbers visible,
marks them stale, and shows a labelled error card.

```js
throw Object.assign(new Error("no credential on this machine"), { code: "auth_missing" });
```

Codes: `auth_missing`, `auth_expired`, `auth_rejected`, `not_installed`,
`not_logged_in`, `unsupported_platform`, `rate_limited`, `network`, `timeout`,
`schema_changed`, `no_data`, `unknown`.

Prefer a precise code over `unknown` — it is what `doctor` shows the user, and it is
the difference between "sign in again" and a shrug.

## The `ctx` you get

| Member | What it does |
|---|---|
| `ctx.config` | Your manifest defaults merged with the user's settings |
| `ctx.secrets.get/set(name)` | Namespaced to your provider, stored 0600 |
| `ctx.state.read()/write(obj)` | Atomic JSON scratch space. Never served over HTTP — put anything sensitive here |
| `ctx.http.getJson/postJson/getText` | Forced timeout, no cross-origin redirects, honest user-agent |
| `ctx.platform` | `{ os, findBinary, runBinary, automation }`. `automation.evalInTab` throws off macOS |
| `ctx.log(event, fields)` | Structured, redacted |
| `ctx.now()` | Injectable, so fixture tests are deterministic |

Use `ctx.http` rather than global `fetch`. It is what enforces the polling manners
this project promises its users.

## Rules that are enforced, not suggested

- `schedule.intervalSeconds` must be **at least 60**. A manifest below that is
  rejected at load.
- `id` must be lowercase kebab-case and match the directory name.
- Every meter needs a `labelKey`.
- Anything not in the meter schema is stripped before storage. You cannot leak a
  conversation id or a token through a meter even if you try.

## Choosing a tier honestly

| Tier | Use when |
|---|---|
| `official-api` | The vendor documents the endpoint and the user supplied the key |
| `local-file` | You only read files the vendor's app wrote. No network |
| `vendor-api` | Vendor's own API, this account only, with the credential their app stored here |
| `session-scrape` | You use a browser session token or parse markup |
| `browser-automation` | You evaluate JavaScript in the user's browser |

Set the manifest tier to the **riskiest** route your adapter can take — that is what
the user's `allowTiers` gate checks. Individual meters may report a safer tier when
they actually took a safer route.

Getting this wrong is the one thing that will get a PR rejected. Users decide what
they are comfortable with based on this field, so it has to be true.
