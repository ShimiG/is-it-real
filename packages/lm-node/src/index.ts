import * as ortDefault from 'onnxruntime-node';
import type { LanguageModel } from '@isitreal/core';
import { loadGpt2With, type LoadOptions } from './gpt2.js';

export * from './gpt2.js';

/** Convenience loader for Node: onnxruntime-node imported normally. */
export async function loadGpt2(modelPath: string, opts: LoadOptions = {}): Promise<LanguageModel> {
  return loadGpt2With(ortDefault, modelPath, opts);
}
