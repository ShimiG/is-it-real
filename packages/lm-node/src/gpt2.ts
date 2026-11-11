import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import type { LanguageModel, LmOutput } from '@isitreal/core';
import { encode } from 'gpt-tokenizer/encoding/r50k_base';
import type * as OrtTypes from 'onnxruntime-node';

/**
 * GPT-2 (124M) from the ONNX Model Zoo (MIT): `gpt2-lm-head-10.onnx`.
 * Input `input1` int64 [batch, 1, seq]; output `output1` float [batch, 1, seq, 50257].
 * Tokenizer: GPT-2 byte-pair encoding (same vocabulary as OpenAI's r50k_base).
 */
export const GPT2_ZOO = {
  id: 'gpt2-124m-onnx-zoo-10',
  file: 'gpt2-lm-head-10.onnx',
  url: 'https://media.githubusercontent.com/media/onnx/models/main/validated/text/machine_comprehension/gpt-2/model/gpt2-lm-head-10.onnx',
  sha256: '12fbb1ec2d2d70c8ebd21a290a348a4109447b98582af64c6f93b6526d5c8f35',
  bytes: 664871060,
  vocabSize: 50257,
  contextTokens: 1024,
  license: 'MIT',
} as const;

export function tokenizeGpt2(text: string): number[] {
  return encode(text);
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export interface LoadOptions {
  /** Verify the file checksum before loading (slower start, recommended for downloads). */
  verify?: boolean;
  threads?: number;
}

/** The parts of onnxruntime-node used here. Passed in so a host can load the library its own way. */
export type OrtLibrary = Pick<typeof OrtTypes, 'InferenceSession' | 'Tensor'>;

export async function loadGpt2With(
  ort: OrtLibrary,
  modelPath: string,
  opts: LoadOptions = {},
): Promise<LanguageModel> {
  if (!existsSync(modelPath)) throw new Error(`Model file not found: ${modelPath}`);
  if (opts.verify === true) {
    const sum = await sha256File(modelPath);
    if (sum !== GPT2_ZOO.sha256) throw new Error(`Checksum mismatch for ${modelPath}: ${sum}`);
  }
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    ...(opts.threads === undefined ? {} : { intraOpNumThreads: opts.threads }),
  });
  return {
    id: GPT2_ZOO.id,
    async run(text: string, maxTokens: number): Promise<LmOutput> {
      const ids = tokenizeGpt2(text).slice(0, Math.min(maxTokens, GPT2_ZOO.contextTokens));
      if (ids.length === 0)
        return {
          modelId: GPT2_ZOO.id,
          tokenIds: [],
          logits: new Float32Array(0),
          vocabSize: GPT2_ZOO.vocabSize,
        };
      const input = new ort.Tensor('int64', BigInt64Array.from(ids.map((i) => BigInt(i))), [
        1,
        1,
        ids.length,
      ]);
      const result = await session.run({ input1: input }, ['output1']);
      return {
        modelId: GPT2_ZOO.id,
        tokenIds: ids,
        logits: result['output1']!.data as Float32Array,
        vocabSize: GPT2_ZOO.vocabSize,
      };
    },
  };
}
