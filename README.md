# Is It Real?

A free, open-source, on-device detector for AI-generated text, images and video, built to help people (especially older adults) spot AI-driven scams.

**Status:** M4 done: a Claude plugin (v0.3) you can install and try. It checks pages, messages and images for scam warning signs and AI-generated content. What it catches and misses: [EVAL.md](EVAL.md). Roadmap: [PLAN.md](PLAN.md).

- **Algorithms first:** provenance (C2PA), metadata, statistics and signal processing. LLMs are used only to explain results, never to decide them.
- **Private:** everything runs locally. No accounts, no uploads, no tracking.
- **Honest:** four outcomes (_Made with AI_, _Likely made with AI_, _No clear signs_, _Not checked_). It never claims something is "human" or "real".

## Try it (Claude plugin)

In Claude Code:

```
/plugin marketplace add ShimiG/is-it-real
```

```
/plugin install is-it-real@is-it-real
```

Then start Claude Code with Claude in Chrome (`claude --chrome`), open a page, and ask "Is this page a scam?" or "Was this picture made with AI?". Details: [plugin/README.md](plugin/README.md).

## Repository

| Path                       | What                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/core`            | Detection core: contracts, outcome rules, plain-language reasons, provenance sniffers, platform-label matcher |
| `packages/c2pa-node`       | Reads and validates Content Credentials (C2PA) with the official library                                      |
| `packages/image-node`      | Decodes images (sharp) and runs the picture model and photo gate (ONNX Runtime) in Node                       |
| `packages/mcp-server`      | MCP server with the `check_page`, `check_text` and `check_image` tools (bundled into `plugin/server`)         |
| `plugin`                   | The Claude plugin: server bundle, "check this page" skill, manifest                                           |
| `packages/lm-node`         | Runs the local language model (GPT-2, ONNX Runtime) in Node                                                   |
| `eval`                     | Evaluation harness, datasets, the committed feature table and the Python parity check                         |
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
