import { InvalidInput } from '@beonauto/operations';
import { Effect, Exit } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { answers, scriptedLanguageModel, textResult } from '../testing/index.ts';
import { execution, inferenceWith } from '../testing/inference-runs.ts';
import { documentOf } from '../testing/spec-documents.ts';
import { inferenceExample } from './inference-description.ts';
import { makeInference } from './inference-primitive.ts';

const { primitive, prepared } = inferenceWith();

describe('the inference primitive', () => {
  it('is named inference and takes Markdown documents', () => {
    expect(primitive).toMatchObject({ name: 'inference', title: 'Inference', mediaType: 'text/markdown' });
  });

  it('calls a spec a prompt', () => {
    expect(primitive.noun).toEqual({ one: 'prompt', other: 'prompts' });
  });

  it('repeats a short answer, renders a small structured one, and points to the details for a long one', () => {
    expect([
      primitive.describeOutput('Profits rose.'),
      primitive.describeOutput({ approve: true }),
      primitive.describeOutput('a'.repeat(400)),
    ]).toEqual([
      'Its answer: “Profits rose.”',
      'Its answer: approve: yes.',
      'Its answer is too long to repeat here; the whole of it is in the details below.',
    ]);
  });

  it('runs an execution for at most the deadline of a call for the most output tokens: 60 s and 25 ms a token for 64000', () => {
    expect(primitive.longestExecutionMs).toBe(1_660_000);
  });

  it('describes its document with an example that is a valid spec', () => {
    expect(primitive.description).toContain(inferenceExample);
    expect(prepared(inferenceExample).summary).toMatchObject({ description: 'Summarizes an account' });
  });

  it('says which provider options a spec may set, and that any other is rejected', () => {
    expect(primitive.description).toContain(
      'provider_options holds, under a provider namespace, only options that shape how the model reasons or writes its answer (anthropic: thinking; openai: textVerbosity, reasoningMode, logitBias;',
    );
    expect(primitive.description).toContain(
      "bedrock: reasoningConfig), and under a gateway's name only the request body fields its operator allows; any other option is rejected.",
    );
  });
});

describe('preparing an inference spec', () => {
  it('summarizes the description, the input schema and the output schema', () => {
    expect(prepared(inferenceExample).summary).toEqual({
      description: 'Summarizes an account',
      inputSchema: { type: 'object', properties: { account: { type: 'string' } }, required: ['account'] },
      outputSchema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
        additionalProperties: false,
      },
      warnings: [],
    });
  });

  it('gives no schemas for a text spec without an input schema', () => {
    expect(prepared(documentOf('model: openai/gpt-5')).summary).toEqual({ warnings: [] });
  });

  it('gives the warnings the document has', () => {
    const source = documentOf('model: openai/gpt-5\noutput:\n  format: json\n  schema: {type: object}');

    expect(prepared(source).summary.warnings).toEqual([
      'Line 5, /output/schema: An object should set "additionalProperties": false; strict structured outputs reject open objects (openai, azure)',
    ]);
  });
});

describe('preparing an inference document that is not valid', () => {
  it('rejects it with its problems, each with its line', () => {
    expect(Effect.runSyncExit(primitive.prepare(documentOf('model: gpt-5')))).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The inference spec document has a problem',
          issues: [
            { pointer: '', detail: 'Line 2, /model: Expected provider/model, for example anthropic/claude-sonnet-4-5' },
          ],
        }),
      ),
    );
    expect(Effect.runSyncExit(primitive.prepare(documentOf('model: gpt-5\nseed: 1')))).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The inference spec document has 2 problems',
          issues: [
            { pointer: '', detail: 'Line 2, /model: Expected provider/model, for example anthropic/claude-sonnet-4-5' },
            {
              pointer: '',
              detail:
                'Line 3, /seed: seed is not a key of the front matter; it takes description, model, config, input, output, provider_options',
            },
          ],
        }),
      ),
    );
  });
});

describe('the moment an execution renders', () => {
  it('comes from the clock the primitive is given', async () => {
    const clock = await Effect.runPromise(
      TestClock.setTime(Date.parse('2030-01-02T03:04:05.000Z')).pipe(
        Effect.andThen(Effect.clockWith((current) => Effect.succeed(current))),
        Effect.provide(TestClock.layer()),
      ),
    );
    const scripted = scriptedLanguageModel(answers(textResult('ok')));
    const timed = makeInference({
      languageModel: scripted.languageModel,
      clock,
      offered: { providers: ['anthropic'], aliases: [] },
    });
    const spec = Effect.runSync(
      timed.prepare(documentOf('model: openai/gpt-5', 'Today is {{ today }}, now {{ now }}')),
    );
    await Effect.runPromise(spec.execute({}, execution));

    expect(scripted.requests()[0]?.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Today is 2030-01-02, now 2030-01-02T03:04:05.000Z' }] },
    ]);
  });
});
