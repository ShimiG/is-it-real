"""Parity check for the TypeScript Fast-DetectGPT port.

`sampling_discrepancy_analytic` is a line-by-line NumPy port of
`get_sampling_discrepancy_analytic` from baoguangsheng/fast-detect-gpt (MIT),
scripts/fast_detect_gpt.py at commit 971b052, with the same model used for sampling and scoring.

The TypeScript side (eval/src/parity-export.ts) writes token ids and its own criterion values;
this script runs the same ONNX model through onnxruntime's Python API, recomputes the criterion
independently, and fails if the two disagree.

Usage:
    python3 eval/reference/fast_detect_gpt_reference.py <model.onnx> <parity.json>

Not shipped; evaluation tooling only (ADR-0004). Requires numpy and onnxruntime.
"""

import json
import sys

import numpy as np
import onnxruntime as ort

TOLERANCE = 1e-3


def log_softmax(logits: np.ndarray) -> np.ndarray:
    shifted = logits - logits.max(axis=-1, keepdims=True)
    return shifted - np.log(np.exp(shifted).sum(axis=-1, keepdims=True))


def sampling_discrepancy_analytic(logits_ref: np.ndarray, logits_score: np.ndarray, labels: np.ndarray) -> float:
    # logits_*: [1, seq, vocab]; labels: [1, seq]
    assert logits_ref.shape[0] == 1 and logits_score.shape[0] == 1 and labels.shape[0] == 1
    labels = labels[..., None]
    lprobs_score = log_softmax(logits_score)
    probs_ref = np.exp(log_softmax(logits_ref))
    log_likelihood = np.take_along_axis(lprobs_score, labels, axis=-1).squeeze(-1)
    mean_ref = (probs_ref * lprobs_score).sum(axis=-1)
    var_ref = (probs_ref * np.square(lprobs_score)).sum(axis=-1) - np.square(mean_ref)
    discrepancy = (log_likelihood.sum(axis=-1) - mean_ref.sum(axis=-1)) / np.sqrt(var_ref.sum(axis=-1))
    return float(discrepancy.mean())


def main() -> int:
    model_path, parity_path = sys.argv[1], sys.argv[2]
    session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
    cases = json.load(open(parity_path, encoding="utf-8"))
    worst = 0.0
    for case in cases:
        ids = np.asarray(case["tokenIds"], dtype=np.int64)
        (out,) = session.run(["output1"], {"input1": ids.reshape(1, 1, -1)})
        logits = out.reshape(1, len(ids), -1).astype(np.float64)
        # Same convention as the reference: position t predicts token t + 1.
        value = sampling_discrepancy_analytic(logits[:, :-1], logits[:, :-1], ids[None, 1:])
        diff = abs(value - case["fdCriterion"])
        worst = max(worst, diff)
        print(f"{case['id']:<28} tokens={len(ids):<4} python={value:+.5f} typescript={case['fdCriterion']:+.5f} diff={diff:.2e}")
    print(f"\n{len(cases)} texts, largest difference {worst:.2e} (tolerance {TOLERANCE:.0e})")
    return 0 if worst <= TOLERANCE else 1


if __name__ == "__main__":
    sys.exit(main())
