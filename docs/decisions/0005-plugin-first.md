# 0005: Claude plugin first, extension after the M5 gate

**Status:** accepted (2026-11-09)

## Context

The owner wants a Claude plugin first and the standalone extension once detection works. Spike (b) found that the documented host is Claude Code started with `--chrome`, with a bundled local MCP server, and that it requires a paid Anthropic plan.

## Decision

Phase 1 ships the core as a local MCP server plus a `check-this-page` skill, packaged as a Claude Code plugin with a marketplace file in this repo. Tools take URLs or file paths and return compact verdicts. At the end of M5 the owner decides whether detection quality justifies starting the extension (Phase 2).

## Consequences

- Phase 1 is a developer and demo vehicle; the free extension is the product for older users.
- Because detectors live in the core, Phase 2 reuses them unchanged.
