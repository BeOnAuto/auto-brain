import { Conflict } from '@beonauto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { accessFor } from '../testing/adapter-harness.ts';
import { execution } from '../testing/inference-runs.ts';
import { chatCompletion } from '../testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../testing/recording-fetch.ts';
import { documentOf } from '../testing/spec-documents.ts';
import { makeInference } from './inference-primitive.ts';

const gateway = { name: 'internal', base_url: 'https://llm.internal.example/v1', allowed_provider_options: ['user'] };

async function executedWith(providerOptions: string) {
  const recording = recordingFetch(() => jsonResponse(chatCompletion('Hello')));
  const access = await accessFor({ MODEL_GATEWAYS: JSON.stringify([gateway]) }, { fetch: recording.fetch });
  const primitive = makeInference({ languageModel: access.languageModel });
  const document = documentOf(`model: internal/llama-3.3-70b\nprovider_options:\n  internal: ${providerOptions}`, 'Hi');
  const prepared = Effect.runSync(primitive.prepare(document));
  const exit = await Effect.runPromiseExit(prepared.execute({}, execution));
  return { exit, requests: recording.requests() };
}

describe('an execution with provider options for a gateway', () => {
  it('sends the fields its operator allows', async () => {
    const { exit, requests } = await executedWith('{user: tenant-7}');

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(requests[0]?.body).toMatchObject({ user: 'tenant-7' });
  });

  it('is a conflict naming a field its operator does not allow, and never reaches the gateway', async () => {
    const { exit, requests } = await executedWith('{user: tenant-7, metadata: {budget: unlimited}}');

    expect(exit).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'The gateway internal does not allow the provider option metadata (/provider_options/internal/metadata: Not in the allowed_provider_options of internal); update the spec',
        }),
      ),
    );
    expect(requests).toEqual([]);
  });
});
