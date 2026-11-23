# Is It Real? — notes for Claude

Read this first in any new session. The repo is the project's memory: if a chat is lost, everything needed to carry on is here.

## What this is

A free, open-source (Apache-2.0), on-device tool that checks the page in front of you for **scam warning signs** and for **AI-made text, pictures and video**. Built for people who can be fooled by AI-made scams, especially older adults. A portfolio project of the owner (GitHub `ShimiG`).

- Where it stands: [PLAN.md](PLAN.md) (status line at the top, milestones in the table), [docs/m6-progress.md](docs/m6-progress.md) (latest work, newest first), [EVAL.md](EVAL.md) (what it catches and misses).
- Decisions: [docs/decisions](docs/decisions/README.md). Owner's standing decisions: PLAN.md §12.
- Results of each milestone: [docs/eval](docs/eval).

## The owner's standing wishes

- **Algorithms decide, LLMs as little as possible** (ADR-0001). Claude only explains results.
- **Offline only**, nothing sent anywhere (ADR-0003).
- **Free.** No paid tier, no opt-in "higher bar" for non-photo pictures (decided 2026-11-16).
- **Four outcomes, never "human", "real" or "safe"** (ADR-0002). At most ~1% false positives (conformal, ADR-0006).
- **Accessible for older people**: plain words, large text, scam risk first.
- A **disclaimer** is shown everywhere: algorithm-based, not 100% accurate.
- English only for now (plus Meta's labels in Hebrew). Repo private for now.
- Delivery: Claude plugin first (`plugin/`), then the Chrome extension (`apps/extension`), maybe mobile later.
- Milestones start only on the owner's go-ahead. Next: finish M6 (try-out with 3–5 older users, owner) and M7 launch (not started).

## How to work here

- `pnpm install`, then `pnpm check` (lint, format, types, tests, eval: same as CI) and `pnpm build`.
- After any change in `packages/core` or `packages/mcp-server`: run `pnpm build` and **commit `plugin/server`** (CI checks the bundle matches the source).
- Prettier rewrites files: run it on what you changed. Generated model JSON must be formatted with Prettier too.
- A version bump touches: `packages/core/src/version.ts` (engine), `packages/mcp-server/src/server.ts`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `plugin/README.md`, `apps/extension/package.json`, `apps/extension/README.md`, `EVAL.md`, `docs/eval/m6-results.md`.
- Extension zip for the owner to try: `pnpm --filter @isitreal/extension run package` → `apps/extension/is-it-real-<version>.zip` (not committed).
- Browser tests use the pre-installed Playwright Chromium; models download to OPFS in tests that need them (`*.local.test.ts` run only locally).
- A path ships only if a test shows it gives the same numbers as the evaluation (ADR-0011 amendment 2).
- When the owner sends "developer report" JSON files from the extension, read the numbers (gate, raw, cut-offs, texts next to each item), explain what happened, fix only what the evidence supports, and record it in `docs/eval/m6-results.md` and `docs/m6-progress.md`.

## Commits and privacy

- Commit as **Shimi `<47611107+ShimiG@users.noreply.github.com>`** (the personal no-reply address), never a work address. Push to `main`.
- Never commit: the owner's own pictures (`eval/datasets/.cache/private/`), the census site list or the addresses in developer reports (only totals), datasets or video clips (they are fetched at evaluation time).
- Don't close PR #1 or delete the `m2-text-detector` branch unless the owner asks.

## Open follow-ups (not milestones)

Labels in other languages; measuring the scam rules and the "page says" hints on real pages; WebGPU on real hardware; Firefox; real scam messages and more census data from the owner.
