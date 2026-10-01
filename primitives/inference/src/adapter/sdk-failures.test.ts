import {
  APICallError,
  EmptyResponseBodyError,
  InvalidArgumentError,
  InvalidPromptError,
  InvalidResponseDataError,
  JSONParseError,
  LoadAPIKeyError,
  LoadSettingError,
  NoObjectGeneratedError,
  NoSuchModelError,
  RetryError,
  UnsupportedFunctionalityError,
} from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { jsonRequest, promptText, textRequest } from '../testing/adapter-harness.ts';
import { exposedText } from '../testing/exposure.ts';
import { mockGeneration } from '../testing/mock-models.ts';

function throwing(failure: Readonly<Error>): () => MockLanguageModelV4 {
  const doGenerate = (): Promise<never> => Promise.reject(failure);
  return () => new MockLanguageModelV4({ doGenerate });
}

const serverError = new APICallError({
  message: 'down',
  url: 'https://x',
  requestBodyValues: { prompt: promptText },
  statusCode: 500,
});

const answerWithoutDetails = Object.assign(
  new NoObjectGeneratedError({
    response: { id: 'r', timestamp: new Date(0), modelId: 'm' },
    usage: {
      inputTokens: 1,
      inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      outputTokens: 2,
      outputTokenDetails: { textTokens: 2, reasoningTokens: 0 },
      totalTokens: 3,
    },
    finishReason: 'stop',
  }),
  { finishReason: undefined, usage: undefined },
);

const unreadable = 'The response of mock could not be read';

const classifications: readonly (readonly [Readonly<Error>, string, string])[] = [
  [
    new InvalidPromptError({ prompt: promptText, message: 'messages must not be empty' }),
    'spec_invalid',
    'The prompt is not valid for this model',
  ],
  [new UnsupportedFunctionalityError({ functionality: 'seed' }), 'spec_invalid', 'The model does not support seed'],
  [
    new NoSuchModelError({ modelId: 'model', modelType: 'languageModel' }),
    'spec_invalid',
    'The provider has no such model',
  ],
  [
    new InvalidArgumentError({ parameter: 'topK', value: 5, message: 'topK must be an integer' }),
    'spec_invalid',
    'Invalid argument for parameter topK: topK must be an integer',
  ],
  [new LoadAPIKeyError({ message: 'missing key' }), 'provider_not_configured', 'mock is missing a setting'],
  [new LoadSettingError({ message: 'missing region' }), 'provider_not_configured', 'mock is missing a setting'],
  [new EmptyResponseBodyError(), 'provider_unavailable', unreadable],
  [new InvalidResponseDataError({ data: { prompt: promptText } }), 'provider_unavailable', unreadable],
  [new JSONParseError({ text: promptText, cause: new SyntaxError('bad') }), 'provider_unavailable', unreadable],
  [
    new RetryError({ message: 'gave up', reason: 'maxRetriesExceeded', errors: [serverError, serverError] }),
    'provider_unavailable',
    'mock could not serve the request (HTTP 500)',
  ],
  [answerWithoutDetails, 'output_invalid', 'The answer is not JSON'],
];

describe('an SDK failure', () => {
  it.each(classifications)('%s is classified', async (error, tag, detail) => {
    const failure = await mockGeneration(throwing(error)).failed(textRequest('mock/model'));

    expect(failure).toMatchObject({ _tag: tag, detail });
    expect(exposedText(failure)).not.toContain(promptText);
  });

  it('dies, naming only the kind of error, when it is not one this package knows', async () => {
    const exit = await mockGeneration(throwing(new TypeError(promptText))).exit(textRequest('mock/model'));

    expect(Exit.hasDies(exit)).toBe(true);
    expect(exposedText(exit)).toContain('The call to mock failed with TypeError, which this package does not classify');
    expect(exposedText(exit)).not.toContain(promptText);
  });
});

describe('a request that is not valid', () => {
  it('fails as spec_invalid with every issue, before any model is called', async () => {
    const model = new MockLanguageModelV4();
    const request = textRequest('mock/model', {
      messages: [],
      settings: { max_output_tokens: 0, temperature: Number.NaN, top_p: Number.POSITIVE_INFINITY, seed: -1 },
      timeout_ms: 1.5,
    });

    const failure = await mockGeneration(() => model).failed(request);

    expect(failure).toMatchObject({
      _tag: 'spec_invalid',
      issues: [
        { pointer: '/messages', detail: 'Expected at least one message' },
        { pointer: '/settings/max_output_tokens', detail: 'Expected an integer of 1 or more' },
        { pointer: '/settings/temperature', detail: 'Expected a finite number' },
        { pointer: '/settings/top_p', detail: 'Expected a finite number' },
        { pointer: '/settings/seed', detail: 'Expected an integer of 0 or more' },
        { pointer: '/timeout_ms', detail: 'Expected an integer of 1 or more' },
      ],
    });
    expect(model.doGenerateCalls).toEqual([]);
  });

  it('fails as spec_invalid when its output schema is not one this package reads', async () => {
    const model = new MockLanguageModelV4();
    const schema = { document: { type: 'banana' }, validate: () => Result.succeed(null) };

    const failure = await mockGeneration(() => model).failed(
      jsonRequest('mock/model', { output: { type: 'json', schema } }),
    );

    expect(failure).toMatchObject({
      _tag: 'spec_invalid',
      detail: 'The output schema is not one this package can validate',
      issues: [
        {
          pointer: '/output/schema/type',
          detail: 'Expected one of null, boolean, object, array, number, string, integer, or a non-empty list of them',
        },
      ],
    });
    expect(model.doGenerateCalls).toEqual([]);
  });
});
