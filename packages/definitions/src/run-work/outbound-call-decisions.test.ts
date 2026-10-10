import { Conflict, type Recorded } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type {
  DeliveryEndedFact,
  DeliveryStartedFact,
  RunCommand,
  RunResult,
  OutboundCallFact,
} from '../runs/run-commands.ts';
import { runDecider } from '../runs/run-decider.ts';
import { answeredByAReply } from '../runs/run-decisions.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { recordedWith, runStateAfter, testRunId } from '../testing/run-facts.ts';

const start = { runId: testRunId, by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const during = { runId: testRunId, by: 'brain:alpha', at: '2026-10-01T09:00:02.000Z' };

const request = { definition_type: 'interaction', name: 'approve-brief', input: { owner: 'ada' } };

const ofApproval = { definitionType: 'interaction', definitionName: 'approve-brief', definitionVersion: 3 };

const meanwhile = recordedWith({ ...during, ...ofApproval });

const startOfTheRun: RunEvent = { type: 'run_started', data: { input: request.input, finishes_later: true } };

const started = recordedWith({ ...start, ...ofApproval })(startOfTheRun);

const record = {
  to: 'ada',
  message: 'Approve?',
  expires_at: '2026-10-09T09:00:00.000Z',
  requested_at: '2026-10-07T09:00:00.000Z',
};

const deferred = meanwhile({ type: 'run_deferred', data: { record } });

const succeeded = meanwhile({ type: 'run_succeeded', data: { output: {}, record: {} } });

const unavailable = meanwhile({
  type: 'run_rejected',
  data: { rejection: { reason: 'unavailable', detail: 'The tool server is gone' } },
});

const attempt: DeliveryStartedFact = {
  type: 'delivery_started',
  data: { number: 1, target: 'ada', server: 'chat', tool: 'post_message' },
};

const ended: DeliveryEndedFact = {
  type: 'delivery_failed',
  data: { number: 1, because: 'server_failure', duration_ms: 40 },
};

const attemptStarted = meanwhile(attempt);

const attemptEnded = meanwhile(ended);

function stateAfter(...events: readonly Recorded<RunEvent>[]) {
  return runStateAfter(events);
}

function decided(command: RunCommand, ...history: readonly Recorded<RunEvent>[]) {
  return runDecider.decide(command, stateAfter(...history));
}

function recording(fact: OutboundCallFact): RunCommand {
  return { type: 'outbound_call', fact, ...during };
}

function notInFlight(number: number): Conflict {
  return new Conflict({
    detail: `Delivery ${number} is not the attempt of the run in flight, so it cannot end; another attempt ended it, or it never started`,
  });
}

const noMoreWork = new Conflict({ detail: 'The run has ended, so it records no more of its work' });

describe('the deferral of a run', () => {
  it('takes the definition that ran as its context, as its endings do', () => {
    const deferring: RunCommand = { type: 'finish', result: { type: 'run_deferred', data: { record } }, ...during };

    expect(decided(deferring, started)).toStrictEqual(Result.succeed([{ type: 'run_deferred', data: { record } }]));
    expect(runDecider.context(deferring, stateAfter(started))).toStrictEqual({ ...during, ...ofApproval });
  });
});

describe('an outbound call of a run that finishes later', () => {
  it('is recorded as the work of the run, numbered as the next call the run makes', () => {
    const second: DeliveryStartedFact = { ...attempt, data: { ...attempt.data, number: 2 } };

    expect(decided(recording(attempt), started, deferred)).toStrictEqual(Result.succeed([attempt]));
    expect(decided(recording(ended), started, deferred, attemptStarted)).toStrictEqual(Result.succeed([ended]));
    expect(decided(recording(second), started, deferred, attemptStarted, attemptEnded)).toStrictEqual(
      Result.succeed([second]),
    );
    expect(runDecider.context(recording(attempt), stateAfter(started, deferred))).toStrictEqual({
      ...during,
      ...ofApproval,
    });
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
    const secondEnded: DeliveryEndedFact = { ...ended, data: { ...ended.data, number: 2 } };

    expect([
      decided(recording(ended), started, deferred),
      decided(recording(secondEnded), started, deferred, attemptStarted),
      decided(recording(ended), started, deferred, attemptStarted, attemptEnded),
    ]).toEqual([Result.fail(notInFlight(1)), Result.fail(notInFlight(2)), Result.fail(notInFlight(1))]);
    expect(stateAfter(started, deferred, attemptStarted)).toMatchObject({ deliveryInFlight: 1 });
    expect(stateAfter(started, deferred, attemptStarted, attemptEnded)).toMatchObject({
      deliveryInFlight: null,
      broughtAnswer: null,
      deliveredAt: null,
    });
  });

  it('ends the attempt in flight whether it succeeded, failed or was refused', () => {
    const refused = meanwhile({
      type: 'delivery_refused',
      data: { number: 1, because: 'too_large', duration_ms: 0 },
    });

    expect(stateAfter(started, deferred, attemptStarted, refused)).toMatchObject({ deliveryInFlight: null });
  });
});

describe('the deliveries of a run asked to cancel', () => {
  it('starts no attempt once a cancel is asked, though the attempt in flight may still end', () => {
    const cancelAsked = meanwhile({
      type: 'run_cancel_requested',
      data: { kind: 'requested', reason: 'No longer needed' },
    });

    expect(decided(recording(attempt), started, deferred, cancelAsked)).toEqual(
      Result.fail(new Conflict({ detail: 'The run is being cancelled, so it starts no more deliveries' })),
    );
    expect(decided(recording(ended), started, deferred, attemptStarted, cancelAsked)).toStrictEqual(
      Result.succeed([ended]),
    );
  });
});

function settling(result: RunResult): RunCommand {
  return { type: 'settle', result, ...during };
}

describe('a run a reply answered', () => {
  it('leaves the run to be settled with that answer alone, whoever settles it and however', () => {
    const taken = meanwhile({
      type: 'reply_taken',
      data: {
        server: 'chat',
        tool: 'thread_replies',
        reply: { id: '1699.2', sender: 'ada' },
        answer: { choice: 'approve' },
      },
    });
    const answer: RunResult = { type: 'run_succeeded', data: { output: { choice: 'approve' }, record: {} } };
    const history = [started, deferred, attemptStarted, taken];

    expect([
      decided(settling({ type: 'run_succeeded', data: { output: { choice: 'reject' }, record: {} } }), ...history),
      decided(
        settling({
          type: 'run_rejected',
          data: { rejection: { reason: 'cancelled', kind: 'requested', detail: 'Off' } },
        }),
        ...history,
      ),
      decided(settling(answer), ...history),
      decided(settling(answer), started, deferred, attemptStarted, attemptEnded),
    ]).toStrictEqual([
      Result.fail(answeredByAReply),
      Result.fail(answeredByAReply),
      Result.succeed([answer]),
      Result.succeed([answer]),
    ]);
  });
});

describe('the end of a delivery that delivered', () => {
  it('is kept by the run as when it was delivered, for a cancel of a notification, and brings no answer', () => {
    const delivered = meanwhile({
      type: 'delivery_succeeded',
      data: {
        number: 1,
        result_bytes: 20,
        result_sha256: 'b'.repeat(64),
        content_kept: true,
        duration_ms: 40,
        jsonrpc_id: 2,
      },
    });

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
    const startingAgain: RunCommand = {
      type: 'start',
      ...request,
      definition_version: 3,
      calls_tools: false,
      finishes_later: true,
      ...start,
    };

    expect(stateAfter(started, deferred, attemptStarted, attemptEnded)).toMatchObject({
      lastCall: 1,
      mayHaveChanged: false,
    });
    expect(decided(startingAgain, started, attemptStarted, unavailable)).toStrictEqual(Result.succeed([startOfTheRun]));
  });
});
