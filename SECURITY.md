# Security

## Reporting a vulnerability

Please open a GitHub security advisory rather than a public issue. Include what you
found, how to reproduce it, and what an attacker gets. You will get a response.

## Threat model

This runs on your machine, reads your own accounts, and shows you numbers. The
things worth attacking are: the credentials it can reach, the data it serves, and
the fact that it can be bound to a network.

**What is guaranteed**

- Reads are pure. A `GET` never triggers an outbound request to a provider, so an
  exposed endpoint cannot be used to amplify traffic against anyone.
- The server binds `127.0.0.1` by default and refuses to bind any other address
  without a read token.
- Write endpoints are fail-closed: with no write token configured, every write is
  rejected. Tokens are compared with `timingSafeEqual`.
- Everything leaving the process passes an allowlist. A meter may only carry the
  keys defined in the schema, so account identifiers, conversation ids and tokens
  cannot reach an HTTP response or the on-disk snapshot.
- Secrets live in `~/.config/ai-usage-bar/secrets` with mode 0600, never in the
  repository, never in a scheduler unit file, and never in a log line.
- The install directory is read-only at runtime, enforced by a test.

**What is not guaranteed**

- A read token protects the dashboard, not the machine. Anyone who can run code as
  you can read the same credentials this tool reads.
- External provider adapters are arbitrary code running in this process. They load
  only when you name them in your config. Read one before you enable it.
- Binding a LAN address exposes your usage to everyone on that network. Prefer a
  private overlay network, and keep the read token.

## Publishing hygiene

`scripts/scrub-check.mjs` runs in CI and as a pre-commit hook. It fails the build on
home directory paths, private network addresses, emails, key material, JWTs and
Korean text outside locale files, and it derives the machine-specific patterns at
runtime so the check itself carries nothing personal.
