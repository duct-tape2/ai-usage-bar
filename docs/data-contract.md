# Data contract

Two endpoints are stable and versioned. Build against these; everything else may move.

## `GET /api/summary?lang=en`

The widget contract. Everything is pre-rendered because the clients that consume it
— iOS Scriptable, KWGT, Widgy, Shortcuts — cannot do arithmetic, date maths or
conditionals.

```json
{
  "v": 1,
  "updatedAt": "2026-09-07T02:14:11.000Z",
  "updatedAtEpoch": 1789072451,
  "ok": false,
  "worst": { "id": "codex.primary", "label": "Codex weekly", "short": "Codex wk",
             "usedRatio": 0.99, "primaryText": "1%", "state": "critical",
             "resetAt": "2026-09-07T02:25:27.000Z", "resetAtEpoch": 1788747927,
             "resetInText": "14m", "tier": "local-file", "confidence": "exact",
             "stale": false, "error": null, "errorText": null },
  "meters": [ "... same shape, sorted worst-first ..." ],
  "counts": { "ok": 3, "warn": 0, "critical": 1, "exhausted": 0, "unknown": 0, "stale": 0 }
}
```

Guarantees:

- `meters` is an **array**, not an object keyed by id. Widget hosts iterate arrays
  and cannot enumerate object keys.
- Sorted **worst-first**, and `worst` repeats row zero for single-value widgets.
- **Every field is always present.** A failed provider still produces a row, with
  `primaryText: "-"`, `state`, and a localized `errorText`. A widget never has to
  branch on a missing key.
- Every timestamp appears as **both ISO and epoch seconds** — Scriptable wants a
  `Date`, KWGT wants an integer.
- Labels are resolved **server-side** from `?lang`, because a widget cannot ship a
  locale bundle. `short` is at most 12 characters.
- `state` is precomputed from your configured thresholds. The widget draws it.
- Responses carry a strong `ETag`; send `If-None-Match` and expect `304`.
- Target size is under 4 KB, enforced by a test.

Auth: `Authorization: Bearer <read-token>` or `?token=<read-token>`. The query form
exists because several widget HTTP clients cannot set headers; it is accepted for
reads only and query strings are never logged.

## `GET /api/summary.txt`

One line, for Shortcuts, a menu bar title, or `watch`:

```
Codex wk 1%* | Cursor plan 63% | Claude 5h 84% | Claude wk 86%
```

`*` means critical, `!` means exhausted.

## `GET /api/usage`

The full snapshot: every meter with its `window`, `source`, `caps`, `confidence` and
`detail`, plus `providerMeta` and `health`. Meaningfully richer, and **not** wire-
stable yet — the dashboard is its main consumer. Meters carry keys, never prose: a
client resolves text through `GET /api/i18n/<lang>`.

## `POST /api/ingest`

The extension point for collectors that cannot run in-process — a browser
extension, a userscript, or a machine that is not the one showing the dashboard.

```
Authorization: Bearer <write-token>
{ "providerId": "my-thing", "meters": [ ... ], "capturedAt": "..." }
```

The provider's meters are replaced whole, and every meter passes the schema
allowlist on the way in.
