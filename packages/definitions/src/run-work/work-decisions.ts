import { Conflict, type Rejection } from '@beonauto/operations';
import { Result } from 'effect';

import { takesAnAnswer } from '../requests/request-record.ts';
import type { CapabilityFact, RunAnswer, RunToolCall, RunWork } from '../runs/run-commands.ts';
import type { RunEvent } from '../runs/run-events.ts';
import {
  awaitsSettlement,
  isRunning,
  takesSettlement,
  type RecordedRunState,
  type RunState,
} from '../runs/run-state.ts';
import { digestOf } from '../runs/settlement-keys.ts';

type Decision = Result.Result<readonly RunEvent[], Rejection<'conflict'>>;

export type AdmitsFact = (fact: CapabilityFact) => boolean;

export const runEnded = new Conflict({ detail: 'The run has ended, so it records no more of its work' });

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

export function decideToolCall({ fact }: RunToolCall, state: RunState): Decision {
  if (state === undefined || !isRunning(state)) {
    return Result.fail(runEnded);
  }
  if (fact.type !== 'tool_call_started') {
    return Result.succeed([fact]);
  }
  return Result.map(nextCallOf(state, fact.data.number), (number): readonly RunEvent[] => [
    { type: fact.type, data: { ...fact.data, number } },
  ]);
}

function undeclared({ type }: CapabilityFact): Conflict {
  return new Conflict({
    detail: `No capability of this brain declares the fact ${type}, so the run does not record it`,
  });
}

export function decideWork({ fact }: RunWork, state: RunState, admits: AdmitsFact): Decision {
  if (state === undefined || !takesSettlement(state)) {
    return Result.fail(runEnded);
  }
  return admits(fact) ? Result.succeed([{ type: 'work', data: { fact } }]) : Result.fail(undeclared(fact));
}

export const answeredAlready = new Conflict({
  detail: 'The run already took another answer, and a run takes one answer, so it takes no other',
});

const takesNoAnswer = new Conflict({ detail: 'The run waits on no request that takes an answer' });

export const endedUnanswered = new Conflict({
  detail: 'The run is not waiting for an answer: it has ended, or has not asked yet, so it takes none',
});

export function decideAnswer({ answer }: RunAnswer, state: RunState): Decision {
  const taken = state?.answer ?? null;
  if (taken !== null) {
    return digestOf(taken.answer) === digestOf(answer.answer) ? Result.succeed([]) : Result.fail(answeredAlready);
  }
  if (state === undefined || !awaitsSettlement(state)) {
    return Result.fail(endedUnanswered);
  }
  return takesAnAnswer(state.record)
    ? Result.succeed([{ type: 'request_answered', data: answer }])
    : Result.fail(takesNoAnswer);
}
