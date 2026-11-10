# Scam datasets

| File         | Items              | Use                                                                                                                                                                     |
| ------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev.jsonl`  | 25 scam, 25 benign | Tuning rules. Change rules freely against this.                                                                                                                         |
| `test.jsonl` | 40 scam, 40 benign | **Frozen.** Committed before the first rule (commit `208f7e6`). Never tune against it; never edit it. If it needs to grow, add a new `test-v2.jsonl` and keep this one. |

All items were written by an AI assistant, modelled on scam types described in public consumer-protection guidance (gift-card, government impersonation, tech support, family emergency, romance, prize, investment, bank phishing, delivery, job, rental, advance fee, charity). Benign items are deliberate look-alikes: scam-awareness articles, real bank and delivery notices, sales with deadlines, family messages, news about scams.

Limit: author-written data shares the rule author's idea of what scams look like. Real reported scam messages are needed (see `docs/eval/m1-results.md`).

Real-message sets (SMS ham and spam) are downloaded by `pnpm eval:fetch` into `eval/datasets/.cache` and are not redistributed here.
