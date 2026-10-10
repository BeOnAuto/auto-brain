import { Effect } from 'effect';

import type { FilterSandbox } from '../filters/filter-verdicts.ts';
import { namedArguments, type ExpressionUnit } from '../programs/expression-units.ts';
import type { FilterContext } from '../programs/kept-contexts.ts';
import { exhaustedBy, type Evaluation, type ProgramFailure, type ProgramRun } from '../programs/program-run.ts';
import type { MachineSandbox } from '../programs/reserved-instances.ts';
import type { AnsweredRequest } from './evaluation-messages.ts';

export interface EvaluationCalls {
  readonly ready: () => Promise<void>;
  readonly call: (request: AnsweredRequest, waitMs: number) => ProgramRun;
  readonly release: (unit: number) => void;
}

export interface Evaluations {
  readonly machine: MachineSandbox;
  readonly filters: FilterSandbox;
}

interface Remote {
  readonly calls: EvaluationCalls;
  readonly clock: () => number;
  readonly unit: number;
}

const answeredNothing: ProgramRun = { ran: 'answered', text: 'null', work: 0 };

function endingOf(run: ProgramRun): ProgramFailure | undefined {
  return run.ran === 'exhausted' && (run.limit === 'memory' || run.limit === 'deadline')
    ? exhaustedBy(run.limit, 0)
    : undefined;
}

function remoteUnit({ calls, clock, unit }: Remote): ExpressionUnit {
  const state: { ended: ProgramFailure | undefined } = { ended: undefined };
  return {
    evaluate: (source, values, evaluation) => {
      if (state.ended !== undefined) {
        return state.ended;
      }
      const request: AnsweredRequest = {
        kind: 'evaluate',
        unit,
        source,
        ...namedArguments(source, values),
        evaluation,
      };
      const run = calls.call(request, evaluation.deadlineAt - clock());
      state.ended = endingOf(run);
      return run;
    },
    close: () => {
      calls.release(unit);
    },
  };
}

function remoteFilterContext({ calls, clock, unit }: Remote, opening: Evaluation): FilterContext {
  const sources: string[] = [];
  const state: { prepared: ProgramRun | undefined } = { prepared: undefined };
  const prepared = (): ProgramRun => {
    state.prepared ??=
      sources.length === 0
        ? answeredNothing
        : calls.call({ kind: 'prepare', unit, sources, evaluation: opening }, opening.deadlineAt - clock());
    return state.prepared;
  };
  return {
    define: (source) => {
      const test = sources.push(source) - 1;
      return (value, evaluation) => {
        const frozen = prepared();
        return frozen.ran === 'answered'
          ? calls.call({ kind: 'test', unit, test, value, evaluation }, evaluation.deadlineAt - clock())
          : frozen;
      };
    },
    freeze: () => {
      const frozen = prepared();
      return frozen.ran === 'answered' ? undefined : frozen;
    },
    close: () => {
      calls.release(unit);
    },
  };
}

export function remoteEvaluations(calls: EvaluationCalls, clock: () => number): Evaluations {
  const units = { last: 0 };
  const next = (): Remote => {
    units.last += 1;
    return { calls, clock, unit: units.last };
  };
  return {
    machine: {
      reserve: Effect.promise(calls.ready),
      unit: () => remoteUnit(next()),
      clock,
    },
    filters: {
      context: async (opening) => {
        await calls.ready();
        return remoteFilterContext(next(), opening());
      },
      clock,
    },
  };
}
