# Contributing

Thanks for helping. This project protects people, so accuracy claims and wording matter as much as code.

## Setup

Requirements: Node 22+ and pnpm 10 (`corepack enable` installs the pinned version).

```bash
pnpm install
```

```bash
pnpm check
```

`pnpm check` runs lint, formatting, type checks, tests and the toy evaluation, the same as CI.

## Layout

| Path                  | What                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `packages/core`       | Detection core: shared types, outcome rules, reason text, detectors                                                 |
| `packages/lm-node`    | Node runner for the local language model                                                                            |
| `packages/c2pa-node`  | Content Credentials (C2PA) reader for Node, with the bundled trust list                                             |
| `packages/image-node` | Image decoding for Node                                                                                             |
| `eval`                | Evaluation harness (`pnpm eval`), datasets, feature table (`eval/features`), Python parity check (`eval/reference`) |
| `spikes/*`            | Throwaway experiments that answer one question each (see `docs/spikes`)                                             |
| `docs/decisions`      | Decision records (ADRs)                                                                                             |

## Rules that reviews enforce

1. **No LLM produces a score** ([ADR-0001](docs/decisions/0001-algorithms-decide-llms-explain.md)).
2. **No "human", "real" or "safe" verdicts, and no bare percentages** in user-facing text ([ADR-0002](docs/decisions/0002-four-outcomes-never-human.md)). Tests check this.
3. **No network calls** beyond model download and the page's own media ([ADR-0003](docs/decisions/0003-offline-only.md)).
4. **Every detector change comes with eval numbers.** A pull request that changes scores includes the `pnpm eval` before/after table. Never quote toy-set numbers.
5. **All user-facing strings live in `packages/core/src/reasons/en.ts`**, so translations need no code changes.
6. **Datasets record their source and licence** in every item (`source` field). Don't add data you can't redistribute; link to it instead.
7. New design decisions get a short record in `docs/decisions`.

## Commits

Small, focused commits with a clear message. Run `pnpm check` before pushing.

## License

By contributing you agree your contribution is licensed under Apache-2.0 (see `LICENSE`).
