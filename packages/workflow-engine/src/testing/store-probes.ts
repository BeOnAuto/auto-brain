import type { Settlement } from '@beonauto/operations';
import { Effect } from 'effect';

import type { DispatchWatermark, RunContext } from '../dispatch/dispatch-watermark.ts';
import { newRun, type RunState } from '../machine/run-state.ts';
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
  readonly runStore: RunStore;
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
    title: 'gives the runs due before a time, by the latest note of each, and no run that settled',
    expected: ['due at 2000: 1', 'due at 500: 0', 'after an older note: 1', 'settled: 0'],
    run: (subject) =>
      Effect.gen(function* () {
        const { executionId } = subject.run;
        yield* subject.know(executionId);
        yield* subject.recordStore.noteDue({ executionId, version: 2, nextDueAt: 1000 }, subject.run);
        const dueLater = yield* subject.recordStore.dueRuns(2000);
        const dueEarlier = yield* subject.recordStore.dueRuns(500);
        yield* subject.recordStore.noteDue({ executionId, version: 1, nextDueAt: null }, subject.run);
        const afterOlder = yield* subject.recordStore.dueRuns(2000);
        yield* settled(subject, executionId, succeeded);
        const afterSettling = yield* subject.recordStore.dueRuns(2000);
        return [
          `due at 2000: ${dueLater.length}`,
          `due at 500: ${dueEarlier.length}`,
          `after an older note: ${afterOlder.length}`,
          `settled: ${afterSettling.length}`,
        ];
      }),
  },
];

function loadedOf({ snapshot, tail }: StoredRun): string {
  return `loaded ${snapshot?.snapshot.version ?? 0} + ${tail.length}`;
}

const firstTwo = exampleStream.slice(0, 2);

const first = exampleStream.slice(0, 1);

function appendedTo(
  runStore: RunStore,
  executionId: string,
  events: typeof exampleStream,
): Effect.Effect<void, unknown> {
  return Effect.forEach(events, ({ version, event }) => runStore.append(executionId, event, version - 1), {
    discard: true,
  });
}

function stateAt(version: number): RunState {
  return exampleStream.slice(0, version).reduce((state, { event }) => evolveRun(state, event), newRun);
}

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
  {
    title: 'gives the runs whose watermark is below the version of their stream, no more than it is asked for',
    expected: [
      'at 0 of 2: run',
      'at 1 of 2: run',
      'at 2 of 2: none',
      'another run: other',
      'at 2 of 3: other run',
      'at most 1: 1',
    ],
    run: ({ watermark, runStore, executionId }) =>
      Effect.gen(function* () {
        const other = `${executionId}-other`;
        const named = (behind: readonly string[]): string =>
          behind.length === 0
            ? 'none'
            : behind
                .map((id) => (id === executionId ? 'run' : 'other'))
                .toSorted()
                .join(' ');
        yield* appendedTo(runStore, executionId, firstTwo);
        const atStart = yield* watermark.behindRuns(10);
        yield* watermark.advance(executionId, 1);
        const atOne = yield* watermark.behindRuns(10);
        yield* watermark.advance(executionId, 2);
        const atTwo = yield* watermark.behindRuns(10);
        yield* appendedTo(runStore, other, first);
        const withOther = yield* watermark.behindRuns(10);
        yield* appendedTo(runStore, executionId, exampleStream.slice(2));
        const bothBehind = yield* watermark.behindRuns(10);
        const limited = yield* watermark.behindRuns(1);
        return [
          `at 0 of 2: ${named(atStart)}`,
          `at 1 of 2: ${named(atOne)}`,
          `at 2 of 2: ${named(atTwo)}`,
          `another run: ${named(withOther)}`,
          `at 2 of 3: ${named(bothBehind)}`,
          `at most 1: ${limited.length}`,
        ];
      }),
  },
  {
    title: 'gives the runs behind taken longest ago first, so the runs past its limit are taken next',
    expected: ['first: 2 runs', 'second: 2 runs', 'each of the 4 taken once', 'third: 2 of the first'],
    run: ({ watermark, runStore, executionId }) =>
      Effect.gen(function* () {
        const runs = ['a', 'b', 'c', 'd'].map((name) => `${executionId}-${name}`);
        yield* Effect.forEach(runs, (run) => appendedTo(runStore, run, first), { discard: true });
        const firstTaken = yield* watermark.behindRuns(2);
        const secondTaken = yield* watermark.behindRuns(2);
        const thirdTaken = yield* watermark.behindRuns(2);
        const taken = [...firstTaken, ...secondTaken];
        const takenOnce = runs.filter((run) => taken.filter((id) => id === run).length === 1);
        return [
          `first: ${firstTaken.length} runs`,
          `second: ${secondTaken.length} runs`,
          `each of the ${takenOnce.length} taken once`,
          `third: ${thirdTaken.filter((run) => firstTaken.includes(run)).length} of the first`,
        ];
      }),
  },
];

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
        yield* runStore.saveSnapshot({ ...snapshotOf(stateAt(1), 1), executionId });
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
  {
    title: 'keeps the newest snapshot it was given, so an older one saved after it is not kept',
    expected: ['loaded 2 + 0', 'loaded 2 + 0'],
    run: ({ runStore, executionId }) =>
      Effect.gen(function* () {
        yield* appendedTo(runStore, executionId, firstTwo);
        yield* runStore.saveSnapshot({ ...snapshotOf(stateAt(2), 2), executionId });
        const fromNewer = yield* runStore.load(executionId);
        yield* runStore.saveSnapshot({ ...snapshotOf(stateAt(1), 1), executionId });
        const afterOlder = yield* runStore.load(executionId);
        return [loadedOf(fromNewer), loadedOf(afterOlder)];
      }),
  },
];
