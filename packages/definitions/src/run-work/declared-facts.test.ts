import { Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { runFactsOf } from '../index.ts';
import { RunEventSchema } from '../runs/run-events.ts';
import { askedRunId, askingFacts } from '../testing/asked-runs.ts';
import { asking } from '../testing/asking.ts';

const context = {
  at: '2026-10-01T09:00:00.000Z',
  by: 'brain:alpha',
  runId: askedRunId,
  definitionType: 'asking',
  definitionName: 'approve',
  definitionVersion: 1,
};

describe('the facts a ledger reads on a run', () => {
  it('are the brain’s own and those the capabilities composed declare, each in the shape it declares', () => {
    const decode = Schema.decodeUnknownResult(Schema.toCodecJson(askingFacts.decider.eventSchema));

    expect([
      Result.isSuccess(decode({ type: 'nudge_sent', data: { number: 1 }, context })),
      Result.isSuccess(decode({ type: 'nudge_sent', data: { number: 'one' }, context })),
      Result.isSuccess(decode({ type: 'delivery_started', data: { number: 1 }, context })),
    ]).toEqual([true, false, false]);
  });

  it('are any fact of a capability to the brain that knows none, though never one of the brain’s own in another shape', () => {
    const decode = Schema.decodeUnknownResult(Schema.toCodecJson(RunEventSchema));

    expect([
      decode({ type: 'delivery_started', data: { number: 1 }, context }),
      Result.isSuccess(decode({ type: 'run_failed', data: { incident: 1 }, context })),
    ]).toMatchObject([
      Result.succeed({ type: 'work', data: { fact: { type: 'delivery_started', data: { number: 1 } } } }),
      false,
    ]);
  });

  it('are declared once each, and never under a name the brain records itself', () => {
    expect(() => runFactsOf([...asking.facts.onRuns, ...asking.facts.onRuns])).toThrow(
      'The fact nudge_sent is declared more than once or is one the brain records itself',
    );
    expect(() =>
      runFactsOf(asking.facts.onRuns.map(({ schema, present }) => ({ type: 'run_failed', schema, present }))),
    ).toThrow('The fact run_failed is declared more than once or is one the brain records itself');
  });
});
