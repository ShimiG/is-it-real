import type { ImageClassifierRunner, ImageEmbeddingRunner } from '@isitreal/core';
import * as ort from 'onnxruntime-web/wasm';

/**
 * Runs the two model files with ONNX Runtime Web on the CPU (WebAssembly). This backend gives
 * the same numbers as the plugin's runtime for both files (apps/extension/test/models.local.test.ts);
 * the WebGPU backend has not been verified and is not used (ADR-0013).
 */
export function configureRuntime(wasmFolder: string, threads: number): void {
  ort.env.wasm.wasmPaths = wasmFolder;
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.proxy = false;
}

async function session(model: Uint8Array): Promise<ort.InferenceSession> {
  return ort.InferenceSession.create(model, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
}

/** One float32 input [1, 3, size, size]; the first value of the first output is the raw score. */
export async function loadClassifier(
  id: string,
  model: Uint8Array,
): Promise<ImageClassifierRunner> {
  const s = await session(model);
  const input = s.inputNames[0]!;
  const output = s.outputNames[0]!;
  return {
    id,
    async run(tensor: Float32Array, size: number): Promise<number> {
      const result = await s.run(
        { [input]: new ort.Tensor('float32', tensor, [1, 3, size, size]) },
        [output],
      );
      return Number((result[output]!.data as Float32Array)[0]);
    },
  };
}

/** One float32 input [1, 3, size, size]; the first output is the embedding. */
export async function loadEmbedder(id: string, model: Uint8Array): Promise<ImageEmbeddingRunner> {
  const s = await session(model);
  const input = s.inputNames[0]!;
  const output = s.outputNames[0]!;
  return {
    id,
    async run(tensor: Float32Array, size: number): Promise<Float32Array> {
      const result = await s.run(
        { [input]: new ort.Tensor('float32', tensor, [1, 3, size, size]) },
        [output],
      );
      return Float32Array.from(result[output]!.data as Float32Array);
    },
  };
}
