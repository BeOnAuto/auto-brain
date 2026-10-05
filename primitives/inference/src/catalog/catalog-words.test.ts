import { describe, expect, it } from 'vitest';

import { modelsListed } from './catalog-words.ts';
import type { ModelEntry, ModelList } from './model-list.ts';

function model(id: string, owner: string, details: Partial<ModelEntry> = {}): ModelEntry {
  return { id, object: 'model', created: 0, owned_by: owner, ...details };
}

function listOf(data: readonly ModelEntry[], status: ModelList['catalog_status'] = 'complete'): ModelList {
  return { object: 'list', data, catalog_status: status, listed_at: '2026-10-01T09:00:00.000Z' };
}

describe('the plain words for the models a server can call', () => {
  it('count them, name the providers, and name each model as its provider does, or by the last part of its id', () => {
    const list = listOf([
      model('anthropic/claude-sonnet-4-5', 'anthropic', { name: 'Claude Sonnet 4.5' }),
      model('gateway/meta/llama-3.3-70b', 'gateway'),
      model('house/fast', 'gateway', { resolved_to: 'gateway/meta/llama-3.3-70b' }),
    ]);

    expect(modelsListed(list)).toBe(
      'This server can call 3 models through anthropic and gateway: Claude Sonnet 4.5, llama-3.3-70b, and fast.',
    );
  });

  it('name twenty and count the rest', () => {
    const many = Array.from({ length: 23 }, (_, index) =>
      model(`gateway/model-${String(index).padStart(2, '0')}`, 'gateway'),
    );

    expect(modelsListed(listOf(many))).toBe(
      `This server can call 23 models through gateway: ${many
        .slice(0, 20)
        .map(({ id }) => id.slice('gateway/'.length))
        .join(', ')}, and 3 more.`,
    );
  });
});

describe('the plain words for models named by a pattern', () => {
  it('say which providers take any model id, after the models or on their own', () => {
    const patterns = [
      model('anthropic/*', 'gateway', { pattern: true }),
      model('openai/gpt-*', 'gateway', { pattern: true }),
      model('router/meta-llama/*', 'gateway', { pattern: true }),
    ];

    expect(modelsListed(listOf([model('gateway/fast', 'gateway', { name: 'Fast' }), ...patterns]))).toBe(
      'This server can call 1 model through gateway: Fast. It can also call any anthropic model, any openai model starting with gpt-, and any router model starting with meta-llama.',
    );
    expect(modelsListed(listOf([model('bedrock/*', 'bedrock', { pattern: true })]))).toBe(
      'This server can call any bedrock model.',
    );
  });
});

describe('the plain words for no model, or a list that may be incomplete', () => {
  it('say when there is none, through any provider or the one asked about', () => {
    expect(modelsListed(listOf([]))).toBe('This server has no model it can call.');
    expect(modelsListed(listOf([]), 'mistral')).toBe('This server has no model it can call through mistral.');
  });

  it('say when a provider could not be asked', () => {
    expect(modelsListed(listOf([model('gateway/fast', 'gateway')], 'partial'))).toBe(
      'This server can call 1 model through gateway: fast. The list may be incomplete: a provider could not be asked just now.',
    );
  });
});
