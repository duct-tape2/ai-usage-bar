# Contributing

Thanks for looking. The fastest way to help is an adapter for a provider you use, or a bug
report with the exact numbers you saw versus what the vendor showed.

## Run the checks

```
npm run check      # scrub-check (no personal data in the tree) + all tests
npm test           # tests only
```

CI runs the same on Ubuntu and macOS, Node 20/22/24, plus a boot test on a machine with no
accounts at all.

## Adding a provider

Read [docs/adapter-sdk.md](docs/adapter-sdk.md) and copy `src/providers/_template/`. An adapter
returns meters; `src/core/normalize.mjs` does the arithmetic and `src/core/schema.mjs` rejects
anything outside the allowlist, so conversation ids or tokens cannot reach the wire. Add a test
under `test/` with anonymised fixture data (never a real rollout file or API response with ids
in it).

## Reporting a wrong number

Open an issue with: provider, what the dashboard showed, what the vendor's own UI showed, the
`/api/usage` JSON for that meter with any ids removed, and the commit you are on. Do not paste
tokens, cookies or credential files. `scrub-check` runs on every commit for that reason.
