import type { Schema } from 'effect';

import type { ModelResult, TokenUsage } from '../model/model-result.ts';

export const unknownUsage: TokenUsage = {
  input: { total: null, uncached: null, cache_read: null, cache_write: null },
  output: { total: null, text: null, reasoning: null },
  total: null,
};

export function textResult(text: string, overrides: Partial<ModelResult> = {}): ModelResult {
  return {
    text,
    finish_reason: 'stop',
    raw_finish_reason: null,
    usage: unknownUsage,
    model: { requested: 'scripted/model', resolved: 'scripted/model', answered: 'model' },
    response_id: null,
    warnings: [],
    duration_ms: 0,
    ...overrides,
  };
}

export function jsonResult(json: Schema.Json, overrides: Partial<ModelResult> = {}): ModelResult {
  return textResult(JSON.stringify(json), { ...overrides, json });
}
