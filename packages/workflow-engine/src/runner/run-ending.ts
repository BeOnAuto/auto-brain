import type { JsonObject } from '../dsl/json.ts';
import type { RunLimits } from '../machine/run-input.ts';
import type { RunOutcome, ValueId } from '../machine/run-state.ts';
import type { RunCell } from './run-cell.ts';
import type { Inbox } from './run-inbox.ts';
import type { Journal } from './run-tables.ts';
import type { CallTable, TimerTable } from './run-timers.ts';
import { settlementOf } from './settlement.ts';

export interface RunStart {
  readonly executionId: string;
  readonly document: JsonObject;
  readonly input: ValueId;
  readonly limits: RunLimits;
  readonly attributes: JsonObject;
  readonly seed: number;
}

export interface Lifecycle {
  readonly begin: (start: RunStart) => void;
  readonly requestCancel: () => void;
  readonly end: (outcome: RunOutcome) => void;
}

export interface Ending {
  readonly timers: TimerTable;
  readonly calls: CallTable;
  readonly inbox: Inbox;
  readonly journal: Journal;
}

export function lifecycleOf(cell: RunCell, ending: Ending, now: number): Lifecycle {
  return {
    begin: ({ executionId, document, input, limits, attributes, seed }) => {
      const { state } = cell.get();
      cell.update({
        state: {
          ...state,
          executionId,
          status: 'running',
          workflow: { document, input },
          attributes,
          limits,
          startedAt: now,
          random: { seed, draws: 0 },
        },
      });
    },
    requestCancel: () => {
      cell.update({ state: { ...cell.get().state, cancelRequested: true } });
    },
    end: (outcome) => {
      ending.calls.cancelAll();
      ending.timers.disarmAll();
      ending.inbox.clear();
      const { state } = cell.get();
      cell.update({ state: { ...state, status: 'ended', outcome }, root: null });
      ending.journal.emit({ kind: 'settle', executionId: state.executionId, settlement: settlementOf(outcome) });
    },
  };
}
