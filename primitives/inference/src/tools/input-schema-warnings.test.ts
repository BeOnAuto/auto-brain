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

const boundedQuery: Schema.JsonObject = {
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
  it("say where the provider of the run may not hold a tool's arguments to its input schema, and nothing for another provider", async () => {
    const forAnthropic = await offeredOnlyTheSearch(anthropic, boundedQuery);
    const forOpenAi = await offeredOnlyTheSearch(openai, boundedQuery);

    expect([forAnthropic.warnings, forOpenAi.warnings]).toEqual([
      [
        {
          type: 'compatibility',
          feature: `${searchTool} inputSchema#/properties/query/maxLength`,
          detail:
            "maxLength is not enforced while Anthropic models write a tool's arguments; arguments outside it reach the tool, which may refuse them",
        },
      ],
      [],
    ]);
  });

  it('say where the provider of the run may refuse the input schema itself', async () => {
    const forOpenAi = await offeredOnlyTheSearch(openai, { type: 'array', items: { type: 'string' } });

    expect(forOpenAi.warnings).toEqual([
      {
        type: 'compatibility',
        feature: `${searchTool} inputSchema#/type`,
        detail: 'The root of the schema should be "type": "object"',
      },
    ]);
  });

  it('say nothing of an open object with optional properties, since tools are not sent as strict structured outputs', async () => {
    const openQuery = { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } } };

    const forAnthropic = await offeredOnlyTheSearch(anthropic, openQuery);
    const forOpenAi = await offeredOnlyTheSearch(openai, openQuery);

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
