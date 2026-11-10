import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEXT_ENSEMBLE_MODEL, detectTextDeep, lmFeatures } from '@isitreal/core';
import { GPT2_ZOO, loadGpt2, tokenizeGpt2 } from '../src/index.js';

const modelPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'eval',
  'datasets',
  '.cache',
  'models',
  'gpt2',
  GPT2_ZOO.file,
);

describe('GPT-2 tokenizer', () => {
  it('produces the well-known GPT-2 token ids', () => {
    expect(tokenizeGpt2('Hello world')).toEqual([15496, 995]);
    expect(tokenizeGpt2(' the')).toEqual([262]);
    expect(Math.max(...tokenizeGpt2('Zürich café naïve 東京'))).toBeLessThan(GPT2_ZOO.vocabSize);
  });
});

// Needs the 665 MB model file (`pnpm eval:fetch --full`); skipped in CI.
describe.skipIf(!existsSync(modelPath))('GPT-2 ONNX model', () => {
  it('predicts an obvious next word and yields usable features', async () => {
    const lm = await loadGpt2(modelPath);
    const text =
      'The capital of France is Paris. The capital of Italy is Rome. The capital of Spain is Madrid. '.repeat(
        4,
      );
    const out = await lm.run(text, 320);
    expect(out.logits.length).toBe(out.tokenIds.length * GPT2_ZOO.vocabSize);
    const f = lmFeatures(out)!;
    expect(f.top1Rate).toBeGreaterThan(0.6); // repeated text is highly predictable
    expect(f.fdCriterion).toBeGreaterThan(0);
  }, 60_000);

  it('runs the shipped ensemble end to end', async () => {
    const lm = await loadGpt2(modelPath);
    expect(TEXT_ENSEMBLE_MODEL.lmId).toBe(lm.id);
    const text =
      'Gardening offers a wonderful opportunity to connect with nature while improving your physical and mental well-being. Whether you have a spacious backyard or a small balcony, there are countless ways to create a thriving green space. Start by assessing your available sunlight, choose plants suited to your climate, and remember that consistent watering is key to long-term success. Additionally, it is important to note that healthy soil plays a crucial role in plant growth. By incorporating compost and organic matter, you can enhance soil structure and foster a vibrant ecosystem. Ultimately, gardening is a rewarding journey that encourages patience, mindfulness, and a deeper appreciation for the natural world around us.';
    const r = await detectTextDeep(text, lm);
    expect(r.status).toBe('assessed');
    if (r.status === 'assessed') expect(r.signal.score).toBeGreaterThan(0.5);
  }, 60_000);
});
