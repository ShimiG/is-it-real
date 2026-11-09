# 0004: One TypeScript/ONNX core; Python only for evaluation parity

**Status:** accepted (2026-11-09) · supersedes the first planning chat's Python service

## Context

The same detectors must run in a Node MCP server (Phase 1), a browser extension (Phase 2) and possibly mobile. Reference implementations of Fast-DetectGPT and Binoculars are in Python/PyTorch.

## Decision

`@isitreal/core` is TypeScript; models run through ONNX Runtime (Node and Web, WebGPU with a WASM fallback). Python lives only in `eval/reference/`, to check that our ONNX port reproduces the reference scores on the same inputs. It is never shipped.

## Consequences

- One codebase, one set of tests, identical results across hosts.
- Porting scoring code is extra work, so a parity test is part of the M2 definition of done.
