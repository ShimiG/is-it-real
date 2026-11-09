# Is It Real?

A free, open-source, on-device detector for AI-generated text, images and video, built to help people (especially older adults) spot AI-driven scams.

**Status:** M0 (foundations) done. See [PLAN.md](PLAN.md) for the roadmap. No user-facing detector yet.

- **Algorithms first:** provenance (C2PA), metadata, statistics and signal processing. LLMs are used only to explain results, never to decide them.
- **Private:** everything runs locally. No accounts, no uploads, no tracking.
- **Honest:** four outcomes (_Made with AI_, _Likely made with AI_, _No clear signs_, _Not checked_). It never claims something is "human" or "real".

## Repository

| Path                       | What                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/core`            | Detection core: contracts, outcome rules, plain-language reasons, provenance sniffers, platform-label matcher |
| `eval`                     | Evaluation harness: AUROC, detection rate and false positives by subgroup at a conformal threshold            |
| `spikes/provenance-census` | Dev extension measuring how often AI labels and provenance markers appear while browsing                      |
| `docs/decisions`           | Decision records (ADRs)                                                                                       |
| `docs/spikes`              | M0 spike reports                                                                                              |
| `docs/research`            | Background research                                                                                           |

## Development

```bash
pnpm install
```

```bash
pnpm check
```

More in [CONTRIBUTING.md](CONTRIBUTING.md).

## Background

- Research: [docs/research/ai-content-forensics-report.md](docs/research/ai-content-forensics-report.md)
- First planning chat (handoff notes): [docs/history/2026-11-07-first-planning-chat.md](docs/history/2026-11-07-first-planning-chat.md)

## License

Apache-2.0. See [LICENSE](LICENSE).
