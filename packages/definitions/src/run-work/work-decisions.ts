import { Conflict, type Rejection } from '@beonauto/operations';
import { Result } from 'effect';

import type { CommandMetadata, RunOutboundCall, RunReply, RunToolCall } from '../runs/run-commands.ts';
import type { RunEvent } from '../runs/run-events.ts';
import { isRunning, type RunState, type RecordedRunState } from '../runs/run-state.ts';

type Decision = Result.Result<readonly RunEvent[], Rejection<'conflict'>>;

const runEnded = new Conflict({ detail: 'The run has ended, so it records no more of its work' });

export function ofTheDefinition({ run }: RecordedRunState) {
  const { type, name, definition_version } = run;
  return { definition_type: type, name, definition_version };
}

function nextCallOf(state: RecordedRunState, number: number | undefined): Result.Result<number, Conflict> {
  const next = state.lastCall + 1;
  return number === undefined || number === next
    ? Result.succeed(next)
    : Result.fail(
        new Conflict({
          detail: `The run records its calls in order, and call ${number} is not its next call, ${next}; another attempt recorded it first`,
        }),
      );
}

export function decideToolCall({ fact, by, at }: RunToolCall & CommandMetadata, state: RunState): Decision {
  if (state === undefined || !isRunning(state)) {
    return Result.fail(runEnded);
  }
  if (fact.type === 'tool_call_answered') {
    return Result.succeed([{ ...fact, by, at }]);
  }
  return Result.map(nextCallOf(state, fact.number), (number) => [{ ...fact, number, by, at }]);
}

function attemptEndable(state: RecordedRunState, number: number): Result.Result<number, Conflict> {
  return state.deliveryInFlight === number
    ? Result.succeed(number)
    : Result.fail(
        new Conflict({
          detail: `Delivery ${number} is not the attempt of the run in flight, so it cannot end; another attempt ended it, or it never started`,
        }),
      );
}

const beingCancelled = new Conflict({ detail: 'The run is being cancelled, so it starts no more deliveries' });

function attemptStartable(state: RecordedRunState, number: number): Result.Result<number, Conflict> {
  return state.cancel === undefined ? nextCallOf(state, number) : Result.fail(beingCancelled);
}

export function decideOutboundCall({ fact, by, at }: RunOutboundCall & CommandMetadata, state: RunState): Decision {
  if (state === undefined || !isRunning(state)) {
    return Result.fail(runEnded);
  }
  const recorded = { ...fact, ...ofTheDefinition(state), by, at };
  const allowed =
    fact.type === 'delivery_ended' ? attemptEndable(state, fact.number) : attemptStartable(state, fact.number);
  return Result.map(allowed, () => [recorded]);
}

export const replyBounds = { refusals: 10 } as const;

const replySeen = new Conflict({ detail: 'The run has taken or refused this reply already, so it records it once' });

const answeredAlready = new Conflict({
  detail: 'The run was answered by a reply already, so it takes no further reply',
});

const replyWhileCancelling = new Conflict({ detail: 'The run is being cancelled, so it takes no reply' });

const refusedEnough = new Conflict({
  detail: `The run has refused ${replyBounds.refusals} replies, the most it records, so it records no more`,
});

function replyRefusal(state: RecordedRunState, fact: RunReply['fact']): Conflict | undefined {
  if (state.cancel !== undefined) {
    return replyWhileCancelling;
  }
  if (state.repliesSeen.includes(fact.reply.id)) {
    return replySeen;
  }
  if (state.broughtAnswer !== null) {
    return answeredAlready;
  }
  return fact.type === 'reply_taken' || state.replyRefusals < replyBounds.refusals ? undefined : refusedEnough;
}

export function decideReply({ fact, by, at }: RunReply & CommandMetadata, state: RunState): Decision {
  if (state === undefined || !isRunning(state)) {
    return Result.fail(runEnded);
  }
  const refusal = replyRefusal(state, fact);
  return refusal === undefined
    ? Result.succeed([{ ...fact, ...ofTheDefinition(state), by, at }])
    : Result.fail(refusal);
}
