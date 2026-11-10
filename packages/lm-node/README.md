# @isitreal/lm-node

Runs a small local language model in Node with ONNX Runtime and hands token ids and next-token logits to `@isitreal/core`. The model is a probability meter: it is never prompted (ADR-0001, ADR-0009).

Model: GPT-2 124M, `gpt2-lm-head-10.onnx` from the ONNX Model Zoo (MIT). URL, size and sha256 are in `GPT2_ZOO`.

```ts
import { checkTextDeep } from '@isitreal/core';
import { loadGpt2 } from '@isitreal/lm-node';

const lm = await loadGpt2('/path/to/gpt2-lm-head-10.onnx', { verify: true });
const report = await checkTextDeep({ text }, lm);
```
