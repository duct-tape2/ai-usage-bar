# AI Usage Bar

**A self-hosted dashboard for how much of your AI subscriptions is left — that you open on your phone.**
Not a menu bar app.

```
Codex     weekly    1% left   resets in 26m   [local file]
Claude    5h       86% left   resets in 2h 1m [vendor API]
Claude    weekly   86% left   resets in 4d    [vendor API]
```

There are a lot of good tools that tell you what you *spent*. This one answers the
question you actually ask at 2am: **can I keep going, or did I just burn the week's
quota?** — and it answers it from your phone, your tablet, or any other machine,
because it runs as a small server instead of an icon in your menu bar.

> **Status: early.** Codex, Claude and Cursor are verified working. ChatGPT Pro
> ships as experimental (see the table). Grok is not written yet. Interfaces may
> still change.

## Why another one of these

The space is crowded, but almost entirely with macOS menu bar apps and CLI cost
trackers. They are good at what they do and this project does not compete with them.

What none of them do:

| | menu bar apps | cost CLIs | AI Usage Bar |
|---|---|---|---|
| Remaining quota, not just spend | yes | no | yes |
| Reachable from your phone | no | no | **yes** |
| Runs headless on a NAS / server | no | partly | **yes** |
| Survives the laptop going to sleep | no | no | **yes** |
| Says where each number came from | no | no | **yes** |
| Consumer ChatGPT Pro weekly cap | no | no | **yes, experimental — nobody else has it** |

If you want a menu bar app, use one — they are excellent. If you want the number on
your phone's home screen while the collector runs on a machine that never sleeps,
that is this.

## Quick start

Requires Node 20 or newer. No dependencies, no build step, no Docker required.

```bash
git clone https://github.com/duct-tape2/ai-usage-bar.git
cd ai-usage-bar
node bin/ai-usage-bar.mjs init      # write a starter config
node bin/ai-usage-bar.mjs doctor    # what this machine can read, and why not
node bin/ai-usage-bar.mjs serve     # http://127.0.0.1:8791
```

Once the npm package is published the same three commands work as
`npx ai-usage-bar init|doctor|serve` (not published yet).

`doctor` is the important one. It tells you, per provider, whether it is enabled,
what it would read, and what is missing — instead of leaving you with a blank page.

## Getting it on your phone

The dashboard binds `127.0.0.1` by default and **refuses to bind anything else
without a read token**. That is deliberate: the number of self-hosted dashboards
quietly serving personal data to a whole network is not a club worth joining.

```bash
ai-usage-bar token read --new          # prints a token, stores it 0600
ai-usage-bar serve --expose tailscale  # binds your tailnet address
```

Then, for a real HTTPS certificate and no self-signed-certificate pain on iOS
(needed if you want to install it to your home screen):

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:8791
```

Use a port your dashboard is **not** already listening on. Pointing `tailscale serve`
at the same port the server binds makes the tailnet address stop answering plain
HTTP, which looks exactly like the server being down.

## Where the numbers come from

Every meter carries a provenance tier, shown on the card. This is the part other
dashboards leave out, and it is the difference between a number you can act on and
a number you have to trust blindly.

| Tier | Meaning | Default |
|---|---|---|
| `official-api` | A documented endpoint, with a key you supplied | **on** |
| `local-file` | Reads state the vendor's own app wrote on this machine. No network | **on** |
| `vendor-api` | The vendor's own API, for your account only, using the credential their app already stored here. Undocumented | **on** |
| `session-scrape` | A borrowed browser session, or scraped markup | off |
| `browser-automation` | Drives a browser you are already signed into | off |

The last two ship in the box but stay off until you turn them on in config, and the
first run prints what you are agreeing to. See [RISKS.md](RISKS.md) before enabling
them — **this matters, please read it.**

## Providers

| Provider | Tier | How | Status |
|---|---|---|---|
| Codex | `local-file` | The rate limits the Codex CLI already records in its own session files | working |
| Claude (Pro/Max) | `vendor-api` | The OAuth credential Claude Code stored here, against Anthropic's usage endpoint | working |
| Cursor | `vendor-api` | The token Cursor stored in its own local database | working |
| ChatGPT Pro weekly | `session-scrape` | Counts Pro responses in your own account history, so usage from your phone counts too | **experimental** |
| Grok | `vendor-api` | The credential the Grok CLI stored here | not written yet |

**On ChatGPT Pro.** This is the number no other dashboard shows, and it is the
reason this project exists. It is marked experimental for an honest reason: the
counting logic has been running in production against a real Pro account for
days, but the packaged adapter has not yet completed a clean end-to-end run here
— OpenAI's bot protection answered the verification attempt with a challenge
page. If that happens to you, the adapter reports `rate_limited` and backs off
rather than pretending. It is off by default; read [RISKS.md](RISKS.md) first.

Adding one is roughly thirty lines — see [docs/adapter-sdk.md](docs/adapter-sdk.md).
Provider breakage is the thing that kills projects like this, so the adapter surface
is deliberately small enough that you do not have to wait for a maintainer.

## Privacy

- Everything stays on your machine. There is no telemetry, no hosted component, and
  nothing is ever proxied through anyone else's server.
- Credentials are never copied into this project's config; adapters read the ones
  the vendors' own apps already stored, and never hold a refresh token.
- What leaves the process is an allowlist, not a denylist: a meter may only carry
  the keys in the schema, so conversation ids, account identifiers and tokens cannot
  reach the wire even by accident. That guarantee is pinned by a test.
- The repository is read-only at runtime. Config lives in `~/.config/ai-usage-bar`,
  state in `~/.local/state/ai-usage-bar`, and a test fails the build if a run writes
  anything into the install directory.

## License

MIT. See [LICENSE](LICENSE).

Not affiliated with OpenAI, Anthropic, Cursor, xAI or any other provider. All
trademarks belong to their owners.
