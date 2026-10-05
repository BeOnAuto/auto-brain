import type { Settlement } from '@beonauto/operations';
import { Effect } from 'effect';

import type { DispatchWatermark, RunContext } from '../dispatch/dispatch-watermark.ts';
import { newRun } from '../machine/run-state.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import type { RunStore, StoredRun } from '../run-log/run-store.ts';
import { snapshotOf } from '../run-log/snapshot.ts';
import type { RecordStore } from '../settlement/record-store.ts';
import type { Probe } from './port-probes.ts';
import { exampleStream } from './streams.ts';

export interface RecordStoreSubject {
  readonly recordStore: RecordStore;
  readonly run: RunContext;
  readonly know: (executionId: string) => Effect.Effect<void, unknown>;
}

export interface RunStoreSubject {
  readonly runStore: RunStore;
  readonly executionId: string;
}

export interface WatermarkSubject {
  readonly watermark: DispatchWatermark;
  readonly executionId: string;
}

const succeeded: Settlement = { status: 'succeeded', output: 'done' };

function settled(subject: RecordStoreSubject, executionId: string, settlement: Settlement) {
  return subject.recordStore.settle({ executionId, settlement }, { ...subject.run, executionId });
}

export const recordStoreProbes: readonly Probe<RecordStoreSubject>[] = [
  {
    title: 'records a settlement once, and tells another settlement of the same execution apart',
    expected: ['recorded', 'already_recorded', 'settled_otherwise'],
    run: (subject) =>
      Effect.gen(function* () {
        const { executionId } = subject.run;
        yield* subject.know(executionId);
        const first = yield* settled(subject, executionId, succeeded);
        const again = yield* settled(subject, executionId, succeeded);
        const other = yield* settled(subject, executionId, { status: 'failed' });
        return [first, again, other];
      }),
  },
  {
    title: 'records no settlement of an execution it does not know',
    expected: ['unknown_execution'],
    run: (subject) =>
      Effect.map(settled(subject, `${subject.run.executionId}-unknown`, succeeded), (receipt) => [receipt]),
  },
  {
    title: 'gives the runs due before a time or behind, by the latest note of each, and no run that settled',
    expected: ['due at 2000: 1', 'due at 500: 0', 'after an older note: 1', 'behind: 1', 'settled: 0'],
    run: (subject) =>
      Effect.gen(function* () {
        const { executionId } = subject.run;
        yield* subject.know(executionId);
        yield* subject.recordStore.noteDue({ executionId, version: 2, nextDueAt: 1000, behind: false }, subject.run);
        const dueLater = yield* subject.recordStore.dueRuns(2000);
        const dueEarlier = yield* subject.recordStore.dueRuns(500);
        yield* subject.recordStore.noteDue({ executionId, version: 1, nextDueAt: null, behind: false }, subject.run);
        const afterOlder = yield* subject.recordStore.dueRuns(2000);
        yield* subject.recordStore.noteDue({ executionId, version: 3, nextDueAt: null, behind: true }, subject.run);
        const behind = yield* subject.recordStore.dueRuns(0);
        yield* settled(subject, executionId, succeeded);
        const afterSettling = yield* subject.recordStore.dueRuns(2000);
        return [
          `due at 2000: ${dueLater.length}`,
          `due at 500: ${dueEarlier.length}`,
          `after an older note: ${afterOlder.length}`,
          `behind: ${behind.length}`,
          `settled: ${afterSettling.length}`,
        ];
      }),
  },
];

export const watermarkProbes: readonly Probe<WatermarkSubject>[] = [
  {
    title: 'starts at nothing dispatched and never goes down',
    expected: ['0', '3', '3'],
    run: ({ watermark, executionId }) =>
      Effect.gen(function* () {
        const start = yield* watermark.read(executionId);
        yield* watermark.advance(executionId, 3);
        const advanced = yield* watermark.read(executionId);
        yield* watermark.advance(executionId, 2);
        const kept = yield* watermark.read(executionId);
        return [`${start}`, `${advanced}`, `${kept}`];
      }),
  },
];

function loadedOf({ snapshot, tail }: StoredRun): string {
  return `loaded ${snapshot?.snapshot.version ?? 0} + ${tail.length}`;
}

const firstTwo = exampleStream.slice(0, 2);

const first = exampleStream.slice(0, 1);

export const runStoreProbes: readonly Probe<RunStoreSubject>[] = [
  {
    title: 'appends at the version it expects, loads from its latest snapshot and the events after it',
    expected: ['appended', 'appended', 'conflict', 'loaded 0 + 2', 'after 1: 2', 'loaded 1 + 1'],
    run: ({ runStore, executionId }) =>
      Effect.gen(function* () {
        const appended = yield* Effect.forEach(firstTwo, ({ version, event }) =>
          Effect.as(runStore.append(executionId, event, version - 1), 'appended'),
        );
        const conflicts = yield* Effect.forEach(first, ({ event }) =>
          Effect.as(Effect.flip(runStore.append(executionId, event, 0)), 'conflict'),
        );
        const loaded = yield* runStore.load(executionId);
        const after = yield* runStore.eventsAfter(executionId, 1);
        const atFirst = first.reduce((state, { event }) => evolveRun(state, event), newRun);
        yield* runStore.saveSnapshot({ ...snapshotOf(atFirst, 1), executionId });
        const fromSnapshot = yield* runStore.load(executionId);
        return [
          ...appended,
          ...conflicts,
          loadedOf(loaded),
          `after 1: ${after.map(({ version }) => version).join(' ')}`,
          loadedOf(fromSnapshot),
        ];
      }),
  },
];
