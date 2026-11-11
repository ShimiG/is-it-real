import { existsSync } from 'node:fs';
import type { ImageClassifierRunner } from '@isitreal/core';
import type * as OrtTypes from 'onnxruntime-node';

/** The parts of onnxruntime-node used here. Passed in so a host can load the library its own way. */
export type OrtLibrary = Pick<typeof OrtTypes, 'InferenceSession' | 'Tensor'>;

/**
 * ONNX image classifier runner: one float32 NCHW input [1, 3, size, size], one output whose
 * first value is the raw logit (higher = more AI-like). Input and output names are read from the
 * model, so any classifier with that shape works.
 */
export async function loadImageClassifierWith(
  ort: OrtLibrary,
  id: string,
  modelPath: string,
  opts: { threads?: number } = {},
): Promise<ImageClassifierRunner> {
  if (!existsSync(modelPath)) throw new Error(`Model file not found: ${modelPath}`);
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    ...(opts.threads === undefined ? {} : { intraOpNumThreads: opts.threads }),
  });
  const input = session.inputNames[0]!;
  const output = session.outputNames[0]!;
  return {
    id,
    async run(tensor: Float32Array, size: number): Promise<number> {
      const t = new ort.Tensor('float32', tensor, [1, 3, size, size]);
      const result = await session.run({ [input]: t }, [output]);
      return Number((result[output]!.data as Float32Array)[0]);
    },
  };
}
