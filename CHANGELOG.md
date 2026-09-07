# Changelog

## 0.1.0-dev (2026-09-07)

First public cut.

- Codex (weekly, local rollout file), Claude Code (5h and weekly, vendor API), Cursor (plan, vendor API) verified on a clean clone.
- ChatGPT Pro weekly counter shipped as experimental, off by default (session-scrape tier). Verified end to end on one real account on 2026-09-07 (26 responses, matching an independent counter); requests carry browser-equivalent headers so OpenAI's edge does not answer with a challenge page.
- Read token required to bind anything but loopback; a phone stays signed in through a cookie after one `/?token=` visit.
- Every meter carries its provenance tier and reset time; a lapsed Codex window is reported as fresh, not "almost out".
- Deep agentic ChatGPT conversations are attributed to the question that asked, not counted per node.
