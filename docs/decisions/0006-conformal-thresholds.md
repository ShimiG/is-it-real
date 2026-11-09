# 0006: Conformal thresholds at ≤ 1% false positives on human content

**Status:** accepted (2026-11-09)

## Context

Raw detector scores are not probabilities, and a fixed "0.5" cut-off gives unknown false-positive rates that vary by domain and writer population.

## Decision

- **Flag decision:** split-conformal threshold on held-out human calibration items: the ⌈(n+1)(1−α)⌉-th smallest human score, flag when score > threshold. α = 1% for _Likely AI_, α ≈ 0.1% for interrupting alerts. If there are too few human items for the requested α, the threshold is infinite and nothing is flagged (`eval/src/metrics.ts`).
- **Displayed confidence:** isotonic or Platt calibration, separate from the flag decision.
- **Fairness:** false-positive rates are reported per subgroup (for example non-native writers); a subgroup above target blocks a release or gets its own calibration bucket, else it becomes "Not assessed".

## Consequences

- The guarantee holds only for content like the calibration set, so calibration data must cover the content we judge; uncovered content is "Not assessed".
- Calibration sets need hundreds to thousands of human items per bucket for α = 1%.
