import type { Place } from '../dsl/evaluation.ts';
import { withReachableValuesOnly } from '../machine/held-values.ts';
import type { RunState, TaskFrame, ValueId } from '../machine/run-state.ts';
import { countersOf, runCellOf, type Counters, type RunCell } from './run-cell.ts';
import { descriptorsOf, type Descriptors, type MachineOptions } from './run-descriptors.ts';
import { lifecycleOf, type Ending, type Lifecycle } from './run-ending.ts';
import { inboxOf, type Inbox } from './run-inbox.ts';
import {
  journalOf,
  meterOf,
  valueTableOf,
  type Journal,
  type Meter,
  type StepOutcome,
  type ValueTable,
} from './run-tables.ts';
import { callTableOf, timerTableOf, type CallTable, type TimerTable } from './run-timers.ts';

export interface SessionResult {
  readonly state: RunState;
  readonly outputs: ReturnType<Journal['outputs']>;
  readonly steps: ReturnType<Journal['steps']>;
}

export interface Session extends ValueTable, Inbox, Counters, Descriptors, Lifecycle {
  readonly now: number;
  readonly options: MachineOptions;
  readonly meter: Meter;
  readonly placeAt: (reference: string) => Place;
  readonly timers: TimerTable;
  readonly calls: CallTable;
  readonly context: () => ValueId;
  readonly replaceContext: (id: ValueId) => void;
  readonly record: (reference: string, run: number, outcome: StepOutcome) => void;
  readonly root: () => TaskFrame | null;
  readonly setRoot: (root: TaskFrame | null) => void;
  readonly result: () => SessionResult;
}

function resultOf(cell: RunCell, values: ValueTable, ending: Ending, now: number): RunState {
  const run = cell.get();
  return withReachableValuesOnly({
    ...run.state,
    lastInputAt: now,
    inputs: run.state.inputs + 1,
    random: { seed: run.state.random.seed, draws: run.draws },
    runs: run.runs,
    timers: ending.timers.timers(),
    calls: ending.calls.calls(),
    inbox: ending.inbox.inbox(),
    stepsWithoutWaiting: run.stepsWithoutWaiting,
    machine: { values: values.values(), nextValue: values.nextValue(), context: run.context, root: run.root },
  });
}

export function sessionOf(state: RunState, now: number, options: MachineOptions): Session {
  const cell = runCellOf(state);
  const journal = journalOf();
  const values = valueTableOf(state.machine);
  const descriptors = descriptorsOf(cell, values);
  const timers = timerTableOf(state, descriptors, now, journal);
  const calls = callTableOf(state, descriptors, timers, journal);
  const inbox = inboxOf(state.inbox);
  const ending: Ending = { timers, calls, inbox, journal };
  const meter = meterOf();
  return {
    now,
    options,
    meter,
    placeAt: (reference) => ({ reference, now, meter, mostDuration: descriptors.limits().mostDurationMs }),
    timers,
    calls,
    ...values,
    ...inbox,
    ...countersOf(cell),
    ...descriptors,
    ...lifecycleOf(cell, ending, now),
    context: () => cell.get().context,
    replaceContext: (context) => {
      cell.update({ context });
    },
    record: (reference, run, outcome) => {
      journal.record({ reference, run, outcome });
    },
    root: () => cell.get().root,
    setRoot: (root) => {
      cell.update({ root });
    },
    result: () => ({ state: resultOf(cell, values, ending, now), outputs: journal.outputs(), steps: journal.steps() }),
  };
}
