import { InvalidInput } from '@beonauto/operations';
import { Effect, Exit } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { answers, scriptedLanguageModel, textResult } from '../testing/index.ts';
import { execution, reasoningWith } from '../testing/reasoning-runs.ts';
import { documentOf, reasoningExample } from '../testing/spec-documents.ts';
import { onThisServer } from './on-this-server.ts';
import { makeReasoningFunctionAdapter } from './reasoning-function.ts';

const { primitive, prepared } = reasoningWith();

describe('the reasoning function implementation', () => {
  it('is the inference primitive, titled Reasoning, whose definitions are Markdown', () => {
    expect(primitive).toMatchObject({ name: 'inference', title: 'Reasoning', mediaType: 'text/markdown' });
  });

  it('calls a saved definition a reasoning function', () => {
    expect(primitive.noun).toEqual({ one: 'reasoning function', other: 'reasoning functions' });
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

  it('reaches outside the server, since it calls a model provider', () => {
    expect(primitive.reachesOutside).toBe(true);
  });

  it('says a reasoning function calls tools only when it names them, so a started run of it is never run again', () => {
    expect(prepared(reasoningExample).callsTools).toBe(false);
    expect(prepared(documentOf('model: openai/gpt-5\ntools:\n  - graph/search')).callsTools).toBe(true);
  });
});

describe('the longest run of a reasoning function', () => {
  it('is the deadline of its model call for its output tokens, or its tool loop’s bound when it names tools', () => {
    expect([
      prepared(documentOf('model: openai/gpt-5\nconfig:\n  max_output_tokens: 1000')).longestRunMs,
      prepared(documentOf('model: openai/gpt-5\nconfig:\n  max_output_tokens: 1000\ntools:\n  - graph/search'))
        .longestRunMs,
      prepared(documentOf('model: openai/gpt-5\nconfig:\n  max_output_tokens: 64000\ntools:\n  - graph/search'))
        .longestRunMs,
    ]).toEqual([85_000, 600_000, 1_660_000]);
  });
});

describe('the guide to the reasoning function document', () => {
  it('is reasoning-function, ending with what this server offers', () => {
    expect(primitive.guide).toEqual({
      name: 'reasoning-function',
      onThisServer: onThisServer({ providers: ['anthropic'], aliases: [] }, false),
    });
  });
});

describe('preparing a reasoning function definition', () => {
  it('summarizes the description, the input schema and the output schema', () => {
    expect(prepared(reasoningExample).summary).toEqual({
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

describe('preparing a reasoning function definition that is not valid', () => {
  it('rejects it with its problems, each with its line', () => {
    expect(Effect.runSyncExit(primitive.prepare(documentOf('model: gpt-5')))).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The reasoning function definition has a problem',
          issues: [
            { pointer: '', detail: 'Line 2, /model: Expected provider/model, for example anthropic/claude-sonnet-4-5' },
          ],
        }),
      ),
    );
    expect(Effect.runSyncExit(primitive.prepare(documentOf('model: gpt-5\nseed: 1')))).toEqual(
      Exit.fail(
        new InvalidInput({
          detail: 'The reasoning function definition has 2 problems',
          issues: [
            { pointer: '', detail: 'Line 2, /model: Expected provider/model, for example anthropic/claude-sonnet-4-5' },
            {
              pointer: '',
              detail:
                'Line 3, /seed: seed is not a key of the front matter; it takes description, model, config, input, output, provider_options, tools',
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
    const timed = makeReasoningFunctionAdapter({
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
