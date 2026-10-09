import { describe, expect, it } from 'vitest';

import { accessFor, jsonRequest, succeeded, textRequest } from '../testing/adapter-harness.ts';
import { chatCompletion } from '../testing/provider-replies.ts';
import { jsonResponse, recordingFetch } from '../testing/recording-fetch.ts';

const gateway = {
  name: 'internal',
  base_url: 'https://llm.internal.example/v1',
  api_key_env: 'INTERNAL_LLM_KEY',
  headers: { 'x-tenant': 'acme', 'x-route': 'eu' },
  query_params: { 'api-version': '2026-09-01' },
  structured_outputs: true,
  include_usage: true,
};

function environmentWith(entry: object): Readonly<Record<string, string>> {
  return { MODEL_GATEWAYS: JSON.stringify([entry]), INTERNAL_LLM_KEY: 'internal-key' };
}

describe('a model gateway', () => {
  it('sends the key it names, its headers and its query parameters to Chat Completions', async () => {
    const recording = recordingFetch(() => jsonResponse(chatCompletion('Hello')));
    const access = await accessFor(environmentWith(gateway), { fetch: recording.fetch });

    const result = await succeeded(access, textRequest('internal/llama-3.3-70b'));

    expect(recording.requests()[0]).toMatchObject({
      url: 'https://llm.internal.example/v1/chat/completions?api-version=2026-09-01',
      headers: { authorization: 'Bearer internal-key', 'x-tenant': 'acme', 'x-route': 'eu' },
      body: { model: 'llama-3.3-70b', max_tokens: 256 },
    });
    expect(result).toMatchObject({ text: 'Hello', response_id: 'chatcmpl-B9MBs8CjcvOU2jLn4n570S5qMJKcT' });
  });

  it('sends the schema when it supports structured outputs', async () => {
    const recording = recordingFetch(() => jsonResponse(chatCompletion('{"verdict":"approve"}')));
    const access = await accessFor(environmentWith(gateway), { fetch: recording.fetch });

    const result = await succeeded(access, jsonRequest('internal/llama-3.3-70b'));

    expect(recording.requests()[0]?.body).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { name: 'verdict', strict: true } },
    });
    expect(result.json).toEqual({ verdict: 'approve' });
  });

  it('asks only for a JSON object, and still validates the answer, when it does not', async () => {
    const recording = recordingFetch(() => jsonResponse(chatCompletion('{"verdict":"approve"}')));
    const plain = { name: 'internal', base_url: 'https://llm.internal.example/v1' };
    const access = await accessFor(environmentWith(plain), { fetch: recording.fetch });

    const result = await succeeded(access, jsonRequest('internal/llama-3.3-70b'));

    const [request] = recording.requests();
    expect(request?.body).toMatchObject({ response_format: { type: 'json_object' } });
    expect(request?.headers['authorization']).toBeUndefined();
    expect(result.json).toEqual({ verdict: 'approve' });
    expect(result.warnings).toContainEqual(expect.objectContaining({ type: 'unsupported', feature: 'responseFormat' }));
  });
});
