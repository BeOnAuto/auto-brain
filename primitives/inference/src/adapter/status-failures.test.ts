import { describe, expect, it } from 'vitest';

import type { ModelFailure } from '../failure/model-failure.ts';
import { RateLimited } from '../failure/rate-limited.ts';
import { accessFor, failed, promptText, textRequest } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';
import { jsonResponse, recordingFetch } from '../testing/recording-fetch.ts';

const apiKey = 'sk-openai-SECRET-5d2f';

function openAiError(message: string, code: string | null = null): object {
  return { error: { message, type: 'invalid_request_error', param: null, code } };
}

async function failureFor(response: () => Response): Promise<ModelFailure> {
  const recording = recordingFetch(response);
  const access = await accessFor({ OPENAI_API_KEY: apiKey }, { fetch: recording.fetch });
  const failure = await failed(access, textRequest('openai/gpt-5'));
  expect(exposedText(failure)).not.toContain(promptText);
  expect(exposedText(failure)).not.toContain(apiKey);
  expect(recording.requests()).toHaveLength(1);
  return failure;
}

function staticAwsCredentials() {
  return Promise.resolve({ accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret' });
}

function retryAfterOf(failure: unknown): number | null {
  return failure instanceof RateLimited ? failure.retry_after_ms : null;
}

describe('a provider that rejects the request', () => {
  it.each([400, 404, 413, 422])('fails as spec_invalid on HTTP %i, quoting the provider', async (status) => {
    const failure = await failureFor(() => jsonResponse(openAiError('Unsupported parameter: temperature'), status));

    expect(failure).toMatchObject({
      _tag: 'spec_invalid',
      provider: 'openai',
      status,
      provider_message: 'Unsupported parameter: temperature',
      detail: `openai rejected the request as invalid (HTTP ${status})`,
    });
  });
});

describe('the provider message of a rejected request', () => {
  it('never quotes a raw response body', async () => {
    const failure = await failureFor(() => new Response('upstream said no', { status: 400 }));

    expect(failure).toMatchObject({ _tag: 'spec_invalid', provider_message: null });
  });

  it('never quotes a body that the SDK passes on as the message', async () => {
    const body = JSON.stringify({ upstream: { echoed: promptText } });
    const recording = recordingFetch(() => new Response(body, { status: 400 }));
    const access = await accessFor(
      { AWS_REGION: 'us-east-1' },
      { fetch: recording.fetch, credentials: { aws: staticAwsCredentials } },
    );

    const failure = await failed(access, textRequest('bedrock-anthropic/us.anthropic.claude-sonnet-4-5-20250929-v1:0'));

    expect(failure).toMatchObject({ _tag: 'spec_invalid', provider: 'bedrock-anthropic', provider_message: null });
    expect(exposedText(failure)).not.toContain(promptText);
  });
});

describe('a provider that refuses or will not authorise the request', () => {
  it('fails as content_refused when the request breaks the content policy', async () => {
    const failure = await failureFor(() => jsonResponse(openAiError('The prompt was filtered', 'content_filter'), 400));

    expect(failure).toMatchObject({ _tag: 'content_refused', provider: 'openai', status: 400, usage: null });
  });

  it.each([401, 403])('fails as credentials_rejected on HTTP %i', async (status) => {
    const failure = await failureFor(() => jsonResponse(openAiError('Incorrect API key provided'), status));

    expect(failure).toMatchObject({ _tag: 'credentials_rejected', provider: 'openai', status });
  });

  it.each([408, 409, 500, 503, 529])('fails as provider_unavailable on HTTP %i', async (status) => {
    const failure = await failureFor(() => jsonResponse(openAiError('Overloaded'), status));

    expect(failure).toMatchObject({ _tag: 'provider_unavailable', provider: 'openai', status });
  });
});

const retryHints: readonly (readonly [string, Readonly<Record<string, string>>, number | null])[] = [
  ['no hint', {}, null],
  ['retry-after in seconds', { 'retry-after': '30' }, 30_000],
  ['retry-after-ms', { 'retry-after-ms': '1500.2' }, 1501],
  ['an unreadable retry-after', { 'retry-after': 'soon' }, null],
  ['a retry-after date in the past', { 'retry-after': new Date(Date.now() - 60_000).toUTCString() }, 0],
];

describe('a provider that limits the rate', () => {
  it.each(retryHints)('fails as rate_limited with %s', async (_, headers, retryAfter) => {
    const failure = await failureFor(() => jsonResponse(openAiError('Rate limit reached'), 429, headers));

    expect(failure).toMatchObject({ _tag: 'rate_limited', provider: 'openai', retry_after_ms: retryAfter });
  });

  it('reads a retry-after date', async () => {
    const later = new Date(Date.now() + 120_000).toUTCString();

    const failure = await failureFor(() =>
      jsonResponse(openAiError('Rate limit reached'), 429, { 'retry-after': later }),
    );

    expect(retryAfterOf(failure)).toBeGreaterThan(100_000);
  });
});
