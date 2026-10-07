import { Conflict, type Rejection } from '@beonauto/operations';
import { Result } from 'effect';

import type { CommandMetadata, ExecutionOutboundCall, ExecutionToolCall } from '../execution/execution-commands.ts';
import type { ExecutionEvent } from '../execution/execution-events.ts';
import { isRunning, type ExecutionState, type RecordedExecution } from '../execution/execution-state.ts';

type Decision = Result.Result<readonly ExecutionEvent[], Rejection<'conflict'>>;

const runEnded = new Conflict({ detail: 'The run has ended, so it records no more of its work' });

export function ofTheDefinition({ execution }: RecordedExecution) {
  const { primitive, name, spec_version } = execution;
  return { primitive, name, spec_version };
}

function nextCallOf(state: RecordedExecution, number: number | undefined): Result.Result<number, Conflict> {
  const next = state.lastCall + 1;
  return number === undefined || number === next
    ? Result.succeed(next)
    : Result.fail(
        new Conflict({
          detail: `The run records its calls in order, and call ${number} is not its next call, ${next}; another attempt recorded it first`,
        }),
      );
}

export function decideToolCall({ fact, by, at }: ExecutionToolCall & CommandMetadata, state: ExecutionState): Decision {
  if (state === undefined || !isRunning(state)) {
    return Result.fail(runEnded);
  }
  if (fact.type === 'tool_call_answered') {
    return Result.succeed([{ ...fact, by, at }]);
  }
  return Result.map(nextCallOf(state, fact.number), (number) => [{ ...fact, number, by, at }]);
}

function attemptEndable(state: RecordedExecution, number: number): Result.Result<number, Conflict> {
  return state.deliveryInFlight === number
    ? Result.succeed(number)
    : Result.fail(
        new Conflict({
          detail: `Delivery ${number} is not the attempt of the run in flight, so it cannot end; another attempt ended it, or it never started`,
        }),
      );
}

const beingCancelled = new Conflict({ detail: 'The run is being cancelled, so it starts no more deliveries' });

function attemptStartable(state: RecordedExecution, number: number): Result.Result<number, Conflict> {
  return state.cancel === undefined ? nextCallOf(state, number) : Result.fail(beingCancelled);
}

export function decideOutboundCall(
  { fact, by, at }: ExecutionOutboundCall & CommandMetadata,
  state: ExecutionState,
): Decision {
  if (state === undefined || !isRunning(state)) {
    return Result.fail(runEnded);
  }
  const recorded = { ...fact, ...ofTheDefinition(state), by, at };
  const allowed =
    fact.type === 'delivery_ended' ? attemptEndable(state, fact.number) : attemptStartable(state, fact.number);
  return Result.map(allowed, () => [recorded]);
}
