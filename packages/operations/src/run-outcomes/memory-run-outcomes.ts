import { Effect } from 'effect';

import {
  runStreamOf,
  streamPrefixOfBrain,
  type RunOutcome,
  type RunOutcomeGroup,
  type RunOutcomeMapping,
  type RunOutcomeSelection,
  type RunOutcomeWindow,
  type RunOutcomesReader,
  type TypedEvent,
} from '../index.ts';

interface KeptOutcome {
  readonly brainKey: string;
  readonly row: RunOutcome;
}

export interface MemoryRunOutcomes {
  readonly project: (stream: string, events: readonly TypedEvent[], encoded: readonly unknown[]) => void;
  readonly readRunOutcomes: RunOutcomesReader['readRunOutcomes'];
}

function isSelected(row: RunOutcome, window: RunOutcomeWindow, { primitive, name }: RunOutcomeSelection): boolean {
  return (
    row.startedDay >= window.from &&
    row.startedDay <= window.to &&
    (primitive === undefined || row.primitive === primitive) &&
    (name === undefined || row.name === name)
  );
}

function emptyGroupOf({ startedDay: day, primitive, name, status }: RunOutcome): RunOutcomeGroup {
  return { day, primitive, name, status, runs: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, durations: [] };
}

function added(group: RunOutcomeGroup, row: RunOutcome): RunOutcomeGroup {
  return {
    ...group,
    runs: group.runs + 1,
    inputTokens: group.inputTokens + (row.inputTokens ?? 0),
    outputTokens: group.outputTokens + (row.outputTokens ?? 0),
    cachedTokens: group.cachedTokens + (row.cachedTokens ?? 0),
    durations: row.durationMs === null ? group.durations : [...group.durations, row.durationMs],
  };
}

function grouped(rows: readonly RunOutcome[]): readonly RunOutcomeGroup[] {
  const groups = new Map<string, RunOutcomeGroup>();
  for (const row of rows) {
    const key = JSON.stringify([row.startedDay, row.primitive, row.name, row.status]);
    groups.set(key, added(groups.get(key) ?? emptyGroupOf(row), row));
  }
  return [...groups.values()];
}

function stagedOutcomes(
  { types, rowAfter }: RunOutcomeMapping,
  kept: ReadonlyMap<string, KeptOutcome>,
  stream: string,
): (
  staged: ReadonlyMap<string, KeptOutcome>,
  [type, event]: readonly [string, unknown],
) => ReadonlyMap<string, KeptOutcome> {
  const run = runStreamOf(stream);
  return (staged, [type, event]) => {
    if (run === undefined || !types.includes(type)) {
      return staged;
    }
    const key = `${run.brainKey}${run.runId}`;
    const row = rowAfter((staged.get(key) ?? kept.get(key))?.row, event);
    return row === undefined ? staged : new Map([...staged, [key, { brainKey: run.brainKey, row }]]);
  };
}

export function memoryRunOutcomes(mapping: RunOutcomeMapping | undefined): MemoryRunOutcomes {
  const kept = new Map<string, KeptOutcome>();
  return {
    project: (stream, events, encoded) => {
      if (mapping === undefined) {
        return;
      }
      const facts = events.map(({ type }, index): readonly [string, unknown] => [type, encoded[index]]);
      const stage = stagedOutcomes(mapping, kept, stream);
      const staged = facts.reduce<ReadonlyMap<string, KeptOutcome>>(
        (outcomes, fact) => stage(outcomes, fact),
        new Map(),
      );
      for (const [key, outcome] of staged) {
        kept.set(key, outcome);
      }
    },
    readRunOutcomes: (brain, window, selection) =>
      Effect.sync(() => {
        const brainKey = streamPrefixOfBrain(brain);
        const rows = [...kept.values()].flatMap((outcome) => (outcome.brainKey === brainKey ? [outcome.row] : []));
        return grouped(rows.filter((row) => isSelected(row, window, selection)));
      }),
  };
}
