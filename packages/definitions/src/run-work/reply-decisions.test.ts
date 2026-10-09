import { Conflict } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { brainFactOf } from '../events/brain-facts.ts';
import type { RunCommand, ReplyFact } from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import type { RunEvent } from '../runs/run-events.ts';

const start = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const during = { by: 'brain:alpha', at: '2026-10-01T09:00:07.000Z' };

const ofApproval = { definition_type: 'interaction', name: 'approve-brief', definition_version: 3 };

const started: RunEvent = {
  type: 'run_started',
  ...ofApproval,
  input: { owner: 'U024BE7LH' },
  finishes_later: true,
  ...start,
};

const deferred: RunEvent = {
  type: 'run_deferred',
  record: { to: 'U024BE7LH' },
  ...ofApproval,
  ...during,
};

const cancelAsked: RunEvent = {
  type: 'run_cancel_requested',
  kind: 'requested',
  reason: 'No longer needed',
  ...ofApproval,
  ...during,
};

const succeeded: RunEvent = { type: 'run_succeeded', output: {}, record: {}, ...ofApproval, ...during };

function reply(id: string) {
  return { id, sender: 'U024BE7LH' };
}

const reading = { server: 'chat', tool: 'thread_replies' };

const taken: ReplyFact = {
  type: 'reply_taken',
  ...reading,
  reply: reply('1699.2'),
  answer: { choice: 'approve' },
};

function refusal(id: string): ReplyFact {
  return { type: 'reply_refused', ...reading, reply: reply(id), because: 'not_an_answer', told: true };
}

function stateAfter(...events: readonly RunEvent[]) {
  return events.reduce((state, event) => runDecider.evolve(state, event), runDecider.initialState);
}

function replying(fact: ReplyFact): RunCommand {
  return { type: 'reply', fact, ...during };
}

function decided(fact: ReplyFact, ...history: readonly RunEvent[]) {
  return runDecider.decide(replying(fact), stateAfter(...history));
}

function recorded(fact: ReplyFact): RunEvent {
  return { ...fact, ...ofApproval, ...during };
}

const refusedTen = Array.from({ length: 10 }, (_, index) => recorded(refusal(`1699.${index + 10}`)));

describe('a reply a run takes as its answer', () => {
  it('is recorded with the definition, and kept as the answer brought back with the reply as evidence', () => {
    expect(decided(taken, started, deferred)).toStrictEqual(Result.succeed([recorded(taken)]));
    expect(stateAfter(started, deferred, recorded(taken))).toMatchObject({
      broughtAnswer: { answer: { choice: 'approve' }, at: during.at, reply: reply('1699.2') },
      repliesSeen: ['1699.2'],
      replyRefusals: 0,
    });
  });

  it('is refused once the run has an answer a reply brought, so a second reply with other words takes nothing', () => {
    const answered = new Conflict({ detail: 'The run was answered by a reply already, so it takes no further reply' });

    expect([
      decided({ ...taken, reply: reply('1699.4') }, started, deferred, recorded(taken)),
      decided(refusal('1699.5'), started, deferred, recorded(taken)),
    ]).toEqual([Result.fail(answered), Result.fail(answered)]);
  });
});

describe('a reply a run refuses', () => {
  it('is recorded and counted, at most ten of them, past which the run records no more', () => {
    expect(decided(refusal('1699.3'), started, deferred)).toStrictEqual(Result.succeed([recorded(refusal('1699.3'))]));
    expect(stateAfter(started, deferred, ...refusedTen)).toMatchObject({ replyRefusals: 10, broughtAnswer: null });
    expect(decided(refusal('1699.30'), started, deferred, ...refusedTen)).toEqual(
      Result.fail(
        new Conflict({ detail: 'The run has refused 10 replies, the most it records, so it records no more' }),
      ),
    );
    expect(decided({ ...taken, reply: reply('1699.31') }, started, deferred, ...refusedTen)).toStrictEqual(
      Result.succeed([recorded({ ...taken, reply: reply('1699.31') })]),
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
    stream: 'runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
    version: 3,
    type: fact.type,
    data: recorded(fact),
    recordedAt: during.at,
  };
}

describe('the replies of a run as facts of the brain', () => {
  it('are none, so no recall function folds them and no trigger fires on them', () => {
    expect([brainFactOf(recordOf(taken)), brainFactOf(recordOf(refusal('1699.3')))]).toEqual([undefined, undefined]);
  });
});
