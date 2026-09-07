# Risks — read this before enabling the off-by-default providers

This project reads your own usage from your own accounts on your own machine. Most
of it is boring and safe. Two of the five provenance tiers are not, and this page
exists so you can decide with the facts rather than find out later.

Nothing here is legal advice.

## The short version

| Tier | What it does | Realistic risk |
|---|---|---|
| `official-api` | Documented endpoint, your own key | None beyond normal API use |
| `local-file` | Reads a file the vendor's app wrote here. No network at all | None |
| `vendor-api` | Vendor's own API, your account, using the credential their app already stored on this machine | Low. Undocumented, so it can break without warning |
| `session-scrape` | Uses a browser session token to call a provider's private web API | **Real. Can breach the provider's terms of use** |
| `browser-automation` | Evaluates JavaScript in a browser tab you are already signed into | **Real. Same, plus it touches your live browser** |

The first three are enabled by default. The last two are shipped but off, and turning
one on requires editing your config on purpose.

## What is actually at stake with the risky tiers

Most providers' terms prohibit programmatic extraction of data from their web
services, with no carve-out for "but it is my own account and my own data". Reading
your remaining quota on a timer is, read literally, a breach.

The realistic consequence is **action against your account** — a warning, a rate
limit, in the worst case a suspension. It is not a lawsuit against you. But it is
your account, and this project cannot carry that risk for you. That is the entire
reason those providers are off by default.

You should also know:

- **A provider can change anything at any time.** These endpoints are private. When
  one changes shape, the adapter reports `schema_changed` and stops guessing rather
  than showing you a wrong number.
- **Polling is capped.** No provider may poll faster than once every 60 seconds, and
  the collectors back off on 401/403/429. An earlier private version of this
  dashboard reloaded a provider's web app every 15 seconds and earned a
  "you are accessing this too frequently" warning. That is precisely the mistake the
  architecture now prevents.
- **Browser automation needs a real browser.** It evaluates a small expression in a
  tab you already have open. It never navigates, reloads, or focuses a tab, and it
  never types into a page.

## What this project will never do

These are hard rules, not current limitations:

1. **It never generates completions through a subscription session.** It reads
   metering data only. This is the line between a usage dashboard and the kind of
   proxy that gets a repository shut down.
2. **It never proxies anything through a server we run.** There is no hosted
   component. Your credentials and your numbers do not leave your machine.
3. **It never redistributes a vendor's code.** No decompiled bundles, no protocol
   definitions lifted from an application, no bundled keys or cookies.
4. **It never asks you for a password.** Adapters use credentials the vendors' own
   applications already stored locally, and never hold a refresh token.
5. **It never phones home.** No telemetry, no analytics, no update pings.

## If you are a provider

If you would prefer an adapter not exist, open an issue and it will be removed
promptly and publicly. There is no interest in an adversarial relationship here —
this is a dashboard for people who are already paying you.

## Turning a risky provider on

```json
{
  "allowTiers": ["official-api", "local-file", "vendor-api", "session-scrape"],
  "providers": {
    "chatgpt-pro": { "enabled": true }
  }
}
```

Both the tier and the provider have to be enabled. Doing one without the other is
treated as "not yet", and `doctor` will tell you which half is missing.
