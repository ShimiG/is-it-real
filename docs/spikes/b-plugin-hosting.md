# Spike (b): where the Claude plugin runs

**Date:** 2026-11-09 · **Status:** done · **Feeds:** ADR-0005, M4

Facts below are from the current Claude docs. Items marked _undocumented_ must not be relied on.

## Findings

1. **Plugin layout.** `.claude-plugin/plugin.json` (only `name` is required); skills in
   `skills/<name>/SKILL.md`; a bundled MCP server in `.mcp.json` at the plugin root, started with
   `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/server.js"]`. Tools appear as
   `mcp__plugin_<plugin>_<server>__<tool>`.
   ([manifest](https://code.claude.com/docs/en/plugins/manifest-reference.md), [components](https://code.claude.com/docs/en/plugins/components.md))
2. **State location.** `${CLAUDE_PLUGIN_ROOT}` is replaced on every update. Downloaded model files and caches go in `${CLAUDE_PLUGIN_DATA}`, which survives updates.
3. **Distribution.** A `.claude-plugin/marketplace.json` in this repo lets users run
   `claude plugin marketplace add ShimiG/is-it-real` and then `claude plugin install …`.
   The desktop app (Code tab, and Cowork on desktop) can install plugins too; bundled local MCP
   servers run there but **not** on claude.ai web.
   ([marketplaces](https://code.claude.com/docs/en/plugins/create-marketplace.md), [install](https://code.claude.com/docs/en/plugins/install.md), [overview](https://claude.com/docs/plugins/overview))
4. **Claude in Chrome + Claude Code.** Start with `claude --chrome` (or `/chrome`); needs extension 1.0.36+ and a direct Anthropic paid plan (Pro, Max, Team, Enterprise). Not available with API-key auth or via Bedrock/Vertex.
   ([Chrome docs](https://code.claude.com/docs/en/chrome.md))
5. **Side panel alone:** in Cowork mode the side panel says plugins and connectors work, but whether
   _local_ MCP servers bundled in plugins run there is _undocumented_.
   ([support article](https://support.claude.com/en/articles/12012173-getting-started-with-claude-in-chrome))
6. **Screenshots** go to the model; the documented way to hand one to another tool is to save it to disk and pass the path (spike a, option C).
7. **Limits.** MCP tool output defaults to 25,000 tokens (`MAX_MCP_OUTPUT_TOKENS`); results over
   50,000 characters are spilled to a file. ([MCP docs](https://code.claude.com/docs/en/mcp.md))

## Decision

- Phase 1 runs in **Claude Code (CLI or desktop) started with `--chrome`**, with our plugin's
  **local stdio MCP server**. The side panel is a stretch goal to re-test at M4.
- Tools take **URLs or file paths**, never base64 blobs, and return **compact verdicts** (outcome +
  reason codes + a few numbers), well under the output limit.
- The paid-plan requirement is accepted for Phase 1 (developer and demo vehicle). The free
  extension (Phase 2) is the accessible product, as the plan already says.
