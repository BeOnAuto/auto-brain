import { Conflict } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type {
  DeliveryEndedFact,
  DeliveryStartedFact,
  ExecutionCommand,
  ExecutionResult,
  OutboundCallFact,
} from '../execution/execution-commands.ts';
import { executionDecider } from '../execution/execution-decider.ts';
import { answeredByAReply } from '../execution/execution-decisions.ts';
import type { ExecutionEvent } from '../execution/execution-events.ts';

const start = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const during = { by: 'brain:alpha', at: '2026-10-01T09:00:02.000Z' };

const request = { primitive: 'interaction', name: 'approve-brief', input: { owner: 'ada' } };

const ofApproval = { primitive: 'interaction', name: 'approve-brief', spec_version: 3 };

const started: ExecutionEvent = {
  type: 'execution_started',
  ...request,
  spec_version: 3,
  finishes_later: true,
  ...start,
};

const deferred: ExecutionEvent = { type: 'execution_deferred', record: { channel: 'inbox' }, ...ofApproval, ...during };

const succeeded: ExecutionEvent = { type: 'execution_succeeded', output: {}, record: {}, ...ofApproval, ...during };

const unavailable: ExecutionEvent = {
  type: 'execution_rejected',
  rejection: { reason: 'unavailable', detail: 'The channel is gone' },
  ...ofApproval,
  ...during,
};

const attempt: DeliveryStartedFact = {
  type: 'delivery_started',
  number: 1,
  target: 'ada',
  server: 'chat',
  tool: 'post_message',
};

const ended: DeliveryEndedFact = {
  type: 'delivery_ended',
  number: 1,
  outcome: 'failed',
  because: 'server_failure',
  duration_ms: 40,
};

const attemptStarted: ExecutionEvent = { ...attempt, ...ofApproval, ...during };

const attemptEnded: ExecutionEvent = { ...ended, ...ofApproval, ...during };

function stateAfter(...events: readonly ExecutionEvent[]) {
  return events.reduce((state, event) => executionDecider.evolve(state, event), executionDecider.initialState);
}

function decided(command: ExecutionCommand, ...history: readonly ExecutionEvent[]) {
  return executionDecider.decide(command, stateAfter(...history));
}

function recording(fact: OutboundCallFact): ExecutionCommand {
  return { type: 'outbound_call', fact, ...during };
}

function notInFlight(number: number): Conflict {
  return new Conflict({
    detail: `Delivery ${number} is not the attempt of the run in flight, so it cannot end; another attempt ended it, or it never started`,
  });
}

const noMoreWork = new Conflict({ detail: 'The run has ended, so it records no more of its work' });

describe('the deferral of a run', () => {
  it('names the definition that ran, as its endings do', () => {
    expect(
      decided(
        { type: 'finish', result: { type: 'execution_deferred', record: { channel: 'inbox' } }, ...during },
        started,
      ),
    ).toStrictEqual(Result.succeed([deferred]));
  });
});

describe('an outbound call of a run that finishes later', () => {
  it('is recorded as the work of the run, with the definition, numbered as the next call the run makes', () => {
    expect(decided(recording(attempt), started, deferred)).toStrictEqual(Result.succeed([attemptStarted]));
    expect(decided(recording(ended), started, deferred, attemptStarted)).toStrictEqual(Result.succeed([attemptEnded]));
    expect(
      decided(recording({ ...attempt, number: 2 }), started, deferred, attemptStarted, attemptEnded),
    ).toStrictEqual(Result.succeed([{ ...attemptStarted, number: 2 }]));
  });

  it('is refused under a number that is not the next, so an attempt two hosts make is recorded once', () => {
    expect(decided(recording(attempt), started, deferred, attemptStarted)).toEqual(
      Result.fail(
        new Conflict({
          detail:
            'The run records its calls in order, and call 1 is not its next call, 2; another attempt recorded it first',
        }),
      ),
    );
  });
});

describe('the end of a delivery', () => {
  it('ends only the attempt in flight, once, so an attempt that never started or already ended is refused', () => {
    expect([
      decided(recording(ended), started, deferred),
      decided(recording({ ...ended, number: 2 }), started, deferred, attemptStarted),
      decided(recording(ended), started, deferred, attemptStarted, attemptEnded),
    ]).toEqual([Result.fail(notInFlight(1)), Result.fail(notInFlight(2)), Result.fail(notInFlight(1))]);
    expect(stateAfter(started, deferred, attemptStarted)).toMatchObject({ deliveryInFlight: 1 });
    expect(stateAfter(started, deferred, attemptStarted, attemptEnded)).toMatchObject({
      deliveryInFlight: null,
      broughtAnswer: null,
      deliveredAt: null,
    });
  });
});

describe('the deliveries of a run asked to cancel', () => {
  it('starts no attempt once a cancel is asked, though the attempt in flight may still end', () => {
    const cancelAsked: ExecutionEvent = {
      type: 'execution_cancel_requested',
      kind: 'requested',
      reason: 'No longer needed',
      ...during,
    };

    expect(decided(recording(attempt), started, deferred, cancelAsked)).toEqual(
      Result.fail(new Conflict({ detail: 'The run is being cancelled, so it starts no more deliveries' })),
    );
    expect(decided(recording(ended), started, deferred, attemptStarted, cancelAsked)).toStrictEqual(
      Result.succeed([attemptEnded]),
    );
  });
});

describe('a run a reply answered', () => {
  it('leaves the run to be settled with that answer alone, whoever settles it and however', () => {
    const taken: ExecutionEvent = {
      type: 'reply_taken',
      server: 'chat',
      tool: 'thread_replies',
      reply: { id: '1699.2', sender: 'ada' },
      answer: { choice: 'approve' },
      ...ofApproval,
      ...during,
    };
    const settling = (result: ExecutionResult): ExecutionCommand => ({ type: 'settle', result, ...during });
    const withTheAnswer = settling({ type: 'execution_succeeded', output: { choice: 'approve' }, record: {} });
    const history = [started, deferred, attemptStarted, taken];

    expect([
      decided(settling({ type: 'execution_succeeded', output: { choice: 'reject' }, record: {} }), ...history),
      decided(
        settling({ type: 'execution_rejected', rejection: { reason: 'cancelled', kind: 'requested', detail: 'Off' } }),
        ...history,
      ),
      decided(withTheAnswer, ...history),
      decided(withTheAnswer, started, deferred, attemptStarted, attemptEnded),
    ]).toMatchObject([
      Result.fail(answeredByAReply),
      Result.fail(answeredByAReply),
      Result.succeed([{ type: 'execution_succeeded', output: { choice: 'approve' } }]),
      Result.succeed([{ type: 'execution_succeeded', output: { choice: 'approve' } }]),
    ]);
  });
});

describe('the end of a delivery that delivered', () => {
  it('is kept by the run as when it was delivered, for a cancel of a notification, and brings no answer', () => {
    const delivered: ExecutionEvent = { ...ended, outcome: 'delivered', ...ofApproval, ...during };

    expect(stateAfter(started, deferred, attemptStarted, delivered)).toMatchObject({
      broughtAnswer: null,
      deliveredAt: during.at,
    });
  });
});

describe('the end of a delivery of a run that ended or starts again', () => {
  it('is refused once the run has ended, and of a run there is not', () => {
    expect(decided(recording(ended), started, deferred, attemptStarted, succeeded)).toEqual(Result.fail(noMoreWork));
    expect(decided(recording(attempt))).toEqual(Result.fail(noMoreWork));
  });

  it('keeps the number of the last call but never says the run may have changed something, so it can run again', () => {
    expect(stateAfter(started, deferred, attemptStarted, attemptEnded)).toMatchObject({
      lastCall: 1,
      mayHaveChanged: false,
    });
    const startingAgain: ExecutionCommand = {
      type: 'start',
      ...request,
      spec_version: 3,
      calls_tools: false,
      finishes_later: true,
      ...start,
    };

    expect(decided(startingAgain, started, attemptStarted, unavailable)).toStrictEqual(Result.succeed([started]));
  });
});
