import type { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ModelResult } from '../model/model-result.ts';
import { accessFor, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { anthropicMessage, openAiResponse } from '../testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../testing/recording-fetch.ts';
import { scriptedTools, searchTool } from '../testing/scripted-tools.ts';

interface Provider {
  readonly model: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly answer: object;
}

const anthropic: Provider = {
  model: 'anthropic/claude-sonnet-4-5',
  environment: { ANTHROPIC_API_KEY: 'k' },
  answer: anthropicMessage('Acme has 2 rows.'),
};

const openai: Provider = {
  model: 'openai/gpt-5',
  environment: { OPENAI_API_KEY: 'k' },
  answer: openAiResponse('Acme has 2 rows.'),
};

const boundedOpenQuery: Schema.JsonObject = {
  type: 'object',
  properties: { query: { type: 'string', maxLength: 80 } },
  required: ['query'],
};

async function offeredOnlyTheSearch(provider: Provider, inputSchema: Schema.JsonObject): Promise<ModelResult> {
  const { tools } = scriptedTools({ inputSchema });
  const access = await accessFor(provider.environment, {
    fetch: recordingFetch(() => jsonResponse(provider.answer)).fetch,
  });
  return succeeded(access, textRequest(provider.model, { tools }));
}

describe('the warnings of a run whose tools have an input schema', () => {
  it('say where the input schema of a tool is not portable to the provider of the run, and nothing about other providers', async () => {
    const forAnthropic = await offeredOnlyTheSearch(anthropic, boundedOpenQuery);
    const forOpenAi = await offeredOnlyTheSearch(openai, boundedOpenQuery);

    expect(forAnthropic.warnings).toEqual([
      {
        type: 'compatibility',
        feature: `${searchTool} inputSchema#/properties/query/maxLength`,
        detail:
          'maxLength is not enforced while Anthropic models write the answer; an answer outside it fails as output_invalid',
      },
    ]);
    expect(forOpenAi.warnings).toEqual([
      {
        type: 'compatibility',
        feature: `${searchTool} inputSchema#`,
        detail: 'An object should set "additionalProperties": false; strict structured outputs reject open objects',
      },
    ]);
  });

  it('say nothing of an input schema portable to the provider of the run', async () => {
    const closedQuery = {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    };

    const forAnthropic = await offeredOnlyTheSearch(anthropic, closedQuery);
    const forOpenAi = await offeredOnlyTheSearch(openai, closedQuery);

    expect([forAnthropic.warnings, forOpenAi.warnings]).toEqual([[], []]);
  });

  it('say nothing of an input schema too large to check', async () => {
    const tooLarge = {
      type: 'object',
      description: 'x'.repeat(70_000),
      properties: { query: { type: 'string', maxLength: 80 } },
      required: ['query'],
    };

    expect((await offeredOnlyTheSearch(anthropic, tooLarge)).warnings).toEqual([]);
  });
});
