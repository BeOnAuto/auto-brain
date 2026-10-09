import { Unavailable } from '@beonauto/operations';
import { Effect, Exit } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { ContentRefused, OutputInvalid, ToolsStopped, type ModelFailure } from '../index.ts';
import { documentOf } from '../testing/definition-documents.ts';
import { reasoningWith } from '../testing/reasoning-runs.ts';
import type { ScriptedReply } from '../testing/scripted-language-model.ts';

const jsonDefinition = documentOf(
  'model: openai/gpt-5\nconfig: {max_output_tokens: 200}\noutput:\n  format: json\n  schema: {type: object}',
);

const usage = {
  input: { total: 900, uncached: 100, cache_read: 800, cache_write: 0 },
  output: { total: 120, text: 100, reasoning: 20 },
  total: 1020,
};

function answeredAfter(milliseconds: number, failureOf: () => ModelFailure): ScriptedReply {
  return () => TestClock.adjust(`${milliseconds} millis`).pipe(Effect.andThen(Effect.fail(failureOf())));
}

function invalidAnswer(finishReason: 'stop' | 'length'): () => ModelFailure {
  return () =>
    new OutputInvalid({
      detail: 'The answer is not JSON',
      provider: 'openai',
      finish_reason: finishReason,
      raw_finish_reason: null,
      usage,
      issues: [],
    });
}

const refused = (): ModelFailure =>
  new ContentRefused({
    detail: 'openai stopped the answer under its content policy',
    provider: 'openai',
    status: null,
    raw_finish_reason: 'content_filter',
    usage,
  });

const stopped = (): ModelFailure =>
  new ToolsStopped({ detail: 'openai kept calling tools', provider: 'openai', because: 'no_answer', usage });

describe('a run rejected after its model answered', () => {
  it('records the tokens the answer used and how long the model took, whatever the rejection', async () => {
    const record = { usage, duration_ms: 1500 };

    const runs = await Promise.all(
      [invalidAnswer('stop'), invalidAnswer('length'), refused, stopped].map((failureOf) =>
        reasoningWith(answeredAfter(1500, failureOf)).executing(jsonDefinition, { text: 'x' }),
      ),
    );

    expect(runs).toMatchObject([
      Exit.fail(new Unavailable({ detail: 'The answer is not JSON; try again', record })),
      Exit.fail({ _tag: 'conflict', record }),
      Exit.fail({ _tag: 'invalid_input', record }),
      Exit.fail(new Unavailable({ detail: 'openai kept calling tools', record })),
    ]);
  });
});
