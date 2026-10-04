import { Conflict, InvalidInput, Unavailable } from '@beonauto/operations';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  Cancelled,
  ContentRefused,
  CredentialsRejected,
  OutputInvalid,
  ProviderNotConfigured,
  ProviderUnavailable,
  RateLimited,
  SpecInvalid,
  TimedOut,
  type ModelFailure,
} from '../index.ts';
import { inferenceWith, type Execution } from '../testing/inference-runs.ts';
import { documentOf } from '../testing/spec-documents.ts';

const jsonSpec = documentOf(
  'model: openai/gpt-5\nconfig: {max_output_tokens: 200}\noutput:\n  format: json\n  schema: {type: object}',
);

function failingWith(failure: () => ModelFailure): Promise<Execution> {
  return inferenceWith(() => Effect.fail(failure())).executing(jsonSpec, { text: 'x' });
}

describe('a provider that rejects the spec', () => {
  it('is a conflict that carries the bounded message of the provider', async () => {
    const failure = new SpecInvalid({
      detail: 'openai answered HTTP 404: the model was not found',
      provider: 'openai',
      status: 404,
      provider_message: 'The model gpt-6 does not exist',
      issues: [],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'openai answered HTTP 404: the model was not found; update the spec. The provider said: The model gpt-6 does not exist',
        }),
      ),
    );
  });

  it('lists what the request checks found, without a message the provider did not give', async () => {
    const failure = new SpecInvalid({
      detail: 'The request is not valid',
      provider: null,
      status: null,
      provider_message: null,
      issues: [{ pointer: '/settings/temperature', detail: 'Expected a finite number' }],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail: 'The request is not valid (/settings/temperature: Expected a finite number); update the spec',
        }),
      ),
    );
  });
});

describe('a JSON answer that is not usable', () => {
  it('is a conflict when it was cut off at the token limit', async () => {
    const failure = new OutputInvalid({
      detail: 'openai stopped the answer at max_output_tokens',
      provider: 'openai',
      finish_reason: 'length',
      raw_finish_reason: 'max_output_tokens',
      usage: null,
      issues: [],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Conflict({
          detail:
            'openai stopped the answer at max_output_tokens (200) before the JSON was complete; raise config.max_output_tokens in the spec',
        }),
      ),
    );
  });

  it('is unavailable when it did not match the schema', async () => {
    const failure = new OutputInvalid({
      detail: 'The answer of openai does not match the output schema',
      provider: 'openai',
      finish_reason: 'stop',
      raw_finish_reason: 'stop',
      usage: null,
      issues: [{ pointer: '/summary', detail: 'Expected string' }],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'The answer of openai does not match the output schema (/summary: Expected string); try again',
        }),
      ),
    );
  });
});

const cannotServe: readonly (readonly [string, () => ModelFailure, string])[] = [
  [
    'provider_not_configured',
    () =>
      new ProviderNotConfigured({
        detail: 'openai is not configured; it needs OPENAI_API_KEY',
        provider: 'openai',
        configured: [],
        missing: ['OPENAI_API_KEY'],
      }),
    'openai is not configured; it needs OPENAI_API_KEY',
  ],
  [
    'provider_not_configured, for a provider it has, such as one whose certificate it does not trust',
    () =>
      new ProviderNotConfigured({
        detail:
          'The TLS certificate of openai is not trusted by this server; its operator must add the certificate authority',
        provider: 'openai',
        configured: ['openai', 'anthropic'],
        missing: ['NODE_EXTRA_CA_CERTS'],
      }),
    'The TLS certificate of openai is not trusted by this server; its operator must add the certificate authority',
  ],
  [
    'credentials_rejected',
    () =>
      new CredentialsRejected({
        detail: 'openai rejected the credentials (HTTP 401)',
        provider: 'openai',
        status: 401,
      }),
    'openai rejected the credentials (HTTP 401)',
  ],
  [
    'rate_limited for 1.5 seconds',
    () =>
      new RateLimited({
        detail: 'openai is limiting the rate of requests',
        provider: 'openai',
        retry_after_ms: 1500,
      }),
    'openai is limiting the rate of requests; try again in 2 seconds',
  ],
  [
    'rate_limited for 20 milliseconds',
    () =>
      new RateLimited({ detail: 'openai is limiting the rate of requests', provider: 'openai', retry_after_ms: 20 }),
    'openai is limiting the rate of requests; try again in 1 second',
  ],
  [
    'rate_limited without a hint',
    () =>
      new RateLimited({
        detail: 'openai is limiting the rate of requests',
        provider: 'openai',
        retry_after_ms: null,
      }),
    'openai is limiting the rate of requests; try again later',
  ],
  [
    'provider_unavailable',
    () =>
      new ProviderUnavailable({
        detail: 'openai could not serve the request (HTTP 503)',
        provider: 'openai',
        status: 503,
      }),
    'openai could not serve the request (HTTP 503); try again later',
  ],
  [
    'timed_out',
    () => new TimedOut({ detail: 'openai did not answer within 65000 ms', provider: 'openai', timeout_ms: 65_000 }),
    'openai did not answer within 65000 ms; try again later',
  ],
];

describe('a provider that cannot serve now', () => {
  it.each(cannotServe)('is unavailable, saying which and when to try again: %s', async (_name, failure, detail) => {
    expect(await failingWith(failure)).toEqual(Exit.fail(new Unavailable({ detail })));
  });
});

describe('a model of a provider the server does not have, while it has others', () => {
  it('is unavailable of the kind model_not_offered, so that the spec can be switched', async () => {
    const failure = new ProviderNotConfigured({
      detail: 'openai is not configured. Configured providers: anthropic, gateway',
      provider: 'openai',
      configured: ['anthropic', 'gateway'],
      missing: ['OPENAI_API_KEY'],
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new Unavailable({
          detail: 'openai is not configured. Configured providers: anthropic, gateway',
          kind: 'model_not_offered',
        }),
      ),
    );
  });
});

describe('an input the model refuses', () => {
  it('is invalid input', async () => {
    const failure = new ContentRefused({
      detail: 'openai refused the request under its content policy',
      provider: 'openai',
      status: 400,
      raw_finish_reason: null,
      usage: null,
    });

    expect(await failingWith(() => failure)).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'openai refused the request under its content policy',
          issues: [{ pointer: '', detail: 'The model refused this input under its content policy' }],
        }),
      ),
    );
  });
});

describe('a cancelled call', () => {
  it('interrupts the execution', async () => {
    const exit = await failingWith(
      () => new Cancelled({ detail: 'The call to openai was cancelled', provider: 'openai' }),
    );

    expect(Exit.hasInterrupts(exit)).toBe(true);
  });
});
