import { Conflict, type Recorded } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { brainFactOf } from '../events/brain-facts.ts';
import type { RunCommand, ReplyFact } from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';

const start = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const during = { runId: testRunId, by: 'brain:alpha', at: '2026-10-01T09:00:07.000Z' };

const ofApproval = { definitionType: 'interaction', definitionName: 'approve-brief', definitionVersion: 3 };

const meanwhile = recordedWith({ ...during, ...ofApproval });

const started = recordedWith({ ...start, ...ofApproval })({
  type: 'run_started',
  data: { input: { owner: 'U024BE7LH' }, finishes_later: true },
});

const deferred = meanwhile({ type: 'run_deferred', data: { record: { to: 'U024BE7LH' } } });

const cancelAsked = meanwhile({
  type: 'run_cancel_requested',
  data: { kind: 'requested', reason: 'No longer needed' },
});

const succeeded = meanwhile({ type: 'run_succeeded', data: { output: {}, record: {} } });

function reply(id: string) {
  return { id, sender: 'U024BE7LH' };
}

const reading = { server: 'chat', tool: 'thread_replies' };

function takenAs(id: string): ReplyFact {
  return { type: 'reply_taken', data: { ...reading, reply: reply(id), answer: { choice: 'approve' } } };
}

const taken = takenAs('1699.2');

function refusal(id: string): ReplyFact {
  return { type: 'reply_refused', data: { ...reading, reply: reply(id), because: 'not_an_answer', told: true } };
}

function stateAfter(...events: readonly Recorded<RunEvent>[]) {
  return runStateAfter(events);
}

function replying(fact: ReplyFact): RunCommand {
  return { type: 'reply', fact, ...during };
}

function decided(fact: ReplyFact, ...history: readonly Recorded<RunEvent>[]) {
  return runDecider.decide(replying(fact), stateAfter(...history));
}

function recorded(fact: ReplyFact): Recorded<RunEvent> {
  return meanwhile(fact);
}

const refusedTen = Array.from({ length: 10 }, (_, index) => recorded(refusal(`1699.${index + 10}`)));

describe('a reply a run takes as its answer', () => {
  it('is recorded, with the definition as its context, and kept as the answer brought back with the reply as evidence', () => {
    expect(decided(taken, started, deferred)).toStrictEqual(Result.succeed([taken]));
    expect(runDecider.context(replying(taken), stateAfter(started, deferred))).toStrictEqual({
      ...during,
      ...ofApproval,
    });
    expect(stateAfter(started, deferred, recorded(taken))).toMatchObject({
      broughtAnswer: { answer: { choice: 'approve' }, at: during.at, reply: reply('1699.2') },
      repliesSeen: ['1699.2'],
      replyRefusals: 0,
    });
  });

  it('is refused once the run has an answer a reply brought, so a second reply with other words takes nothing', () => {
    const answered = new Conflict({ detail: 'The run was answered by a reply already, so it takes no further reply' });

    expect([
      decided(takenAs('1699.4'), started, deferred, recorded(taken)),
      decided(refusal('1699.5'), started, deferred, recorded(taken)),
    ]).toEqual([Result.fail(answered), Result.fail(answered)]);
  });
});

describe('a reply a run refuses', () => {
  it('is recorded and counted, at most ten of them, past which the run records no more', () => {
    expect(decided(refusal('1699.3'), started, deferred)).toStrictEqual(Result.succeed([refusal('1699.3')]));
    expect(stateAfter(started, deferred, ...refusedTen)).toMatchObject({ replyRefusals: 10, broughtAnswer: null });
    expect(decided(refusal('1699.30'), started, deferred, ...refusedTen)).toEqual(
      Result.fail(
        new Conflict({ detail: 'The run has refused 10 replies, the most it records, so it records no more' }),
      ),
    );
    expect(decided(takenAs('1699.31'), started, deferred, ...refusedTen)).toStrictEqual(
      Result.succeed([takenAs('1699.31')]),
    );
  });
});

describe('a reply the run has already seen, or may no longer take', () => {
  it('is refused when the run took or refused that reply, so a reply read twice is recorded once', () => {
    const once = new Conflict({ detail: 'The run has taken or refused this reply already, so it records it once' });

    expect([
      decided(refusal('1699.2'), started, deferred, recorded(taken)),
      decided(refusal('1699.3'), started, deferred, recorded(refusal('1699.3'))),
    ]).toEqual([Result.fail(once), Result.fail(once)]);
  });

  it('is refused once a cancel is asked, once the run has ended, and for a run there is not', () => {
    expect([
      decided(taken, started, deferred, cancelAsked),
      decided(taken, started, deferred, succeeded),
      decided(taken),
    ]).toEqual([
      Result.fail(new Conflict({ detail: 'The run is being cancelled, so it takes no reply' })),
      Result.fail(new Conflict({ detail: 'The run has ended, so it records no more of its work' })),
      Result.fail(new Conflict({ detail: 'The run has ended, so it records no more of its work' })),
    ]);
  });
});

function recordOf(fact: ReplyFact) {
  return {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: null,
    correlationId: null,
    stream: `runs/${testRunId}`,
    version: 3,
    globalPosition: 3,
    type: fact.type,
    data: fact.data,
    context: { ...during, ...ofApproval },
    recordedAt: during.at,
  };
}

describe('the replies of a run as facts of the brain', () => {
  it('are none, so no recall function folds them and no trigger fires on them', () => {
    expect([brainFactOf(recordOf(taken)), brainFactOf(recordOf(refusal('1699.3')))]).toEqual([undefined, undefined]);
  });
});
