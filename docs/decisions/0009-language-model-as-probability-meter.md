# 0009: A small local language model as a probability meter (GPT-2 for now)

**Status:** accepted (2026-11-10)

## Context

The Tier 1 text detector (Fast-DetectGPT and surprisal statistics) needs the per-token probabilities of a language model. ADR-0001 forbids asking a model for opinions, and ADR-0003 requires everything to run on the user's device. The papers use 3 to 7 billion-parameter models, which are far too large for a browser. The development environment for M2 could only download from GitHub, PyPI and npm.

## Decision

- The core defines a `LanguageModel` interface: given text, return token ids and next-token logits. The core computes every statistic from those numbers; the model is never prompted.
- Hosts provide the runner. `@isitreal/lm-node` runs ONNX models with ONNX Runtime in Node (plugin phase). The extension will use ONNX Runtime Web behind the same interface.
- First model: **GPT-2, 124M parameters**, `gpt2-lm-head-10.onnx` from the ONNX Model Zoo (MIT licence, 665 MB, sha256 pinned in `GPT2_ZOO`). Tokenizer: GPT-2 byte-pair encoding via `gpt-tokenizer` (MIT).
- Trained weights are tied to the model: `text-ensemble.model.json` records `lmId`, and the detector refuses to run with a different model.
- The model reads at most the first 320 tokens of a text.
- The TypeScript criterion is checked against an independent NumPy port of the reference implementation (`eval/reference/fast_detect_gpt_reference.py`); they agree to within 1e-5 on 20 texts.

## Consequences

- GPT-2 is old (2019) and weaker than the models in the papers, so our detection rates are lower than published ones. `docs/eval/m2-results.md` has the measured numbers.
- 665 MB is large for a browser download. Before Phase 2 we evaluate smaller or quantized models (for example a quantized GPT-2 or SmolLM2-135M); each candidate needs its own feature table, training run and calibration.
- Swapping the model is a contained change: a new runner, a new feature table, and retrained weights. Nothing else in the core changes.
- The parity check covers the scoring math, not the ONNX export itself (PyTorch weights from Hugging Face were not reachable). It should be repeated against the PyTorch reference when possible.
