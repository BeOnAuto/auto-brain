import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import { workflowMachine } from '../decider/workflow-machine.ts';
import { newRun, type RunState } from '../machine/run-state.ts';
import { eventBytesOf, type PositionedEvent } from '../run-log/run-event.ts';
import { evolveRun, loadedRunOf } from '../run-log/run-fold.ts';
import { isSnapshotDue, snapshotChunks, snapshotOf, type Snapshot } from '../run-log/snapshot.ts';
import { startedOf, testMachine } from '../testing/driver-inputs.ts';
import { armedTimerIds } from '../testing/run-history.ts';
import { workflow } from '../testing/workflows.ts';

const inputs = 40_000;

const executionId = '0199a3c4-7d2e-7c1a-9b3f-000000040000';

const ticking = workflow(`
do:
  - tick: { wait: PT1S }
  - count: { set: '\${ { n: ((.n // 0) + 1) } }' }
  - again: { switch: [{ more: { when: '\${ .n < ${inputs - 1} }', then: tick } }] }
`);

interface StoredRun {
  readonly state: RunState;
  readonly snapshot: Snapshot;
  readonly snapshotBytes: number;
  readonly tail: readonly PositionedEvent[];
  readonly tailBytes: number;
}

const machine = workflowMachine(testMachine);

const utf8 = new TextEncoder();

type RunInput = Parameters<typeof machine.decide>[0];

function nextInput(state: RunState): RunInput {
  const [timerId = ''] = armedTimerIds(state, 'wait');
  const at = state.timers.armed[timerId]?.dueAt ?? state.lastInputAt;
  return { kind: 'timer_fired', executionId, at, timerId };
}

function snapshotBytesOf(snapshot: Snapshot): number {
  return snapshotChunks(snapshot).reduce((sum, chunk) => sum + utf8.encode(chunk).byteLength, 0);
}

function stored(run: StoredRun, event: PositionedEvent): StoredRun {
  const state = evolveRun(run.state, event.event);
  const tail = [...run.tail, event];
  const tailBytes = run.tailBytes + eventBytesOf(event.event);
  if (!isSnapshotDue({ bytes: tailBytes, snapshotBytes: run.snapshotBytes })) {
    return { ...run, state, tail, tailBytes };
  }
  const snapshot = snapshotOf(state, event.version);
  return { state, snapshot, snapshotBytes: snapshotBytesOf(snapshot), tail: [], tailBytes: 0 };
}

function ranToTheEnd(): StoredRun {
  let run: StoredRun = { state: newRun, snapshot: snapshotOf(newRun, 1), snapshotBytes: 0, tail: [], tailBytes: 0 };
  let input: RunInput = startedOf({ executionId, document: ticking }, 1_790_845_200_000);
  for (let version = 1; run.state.status !== 'ended'; version += 1) {
    const [event] = Result.getOrThrow(machine.decide(input, run.state));
    run = event === undefined ? run : stored(run, { version, event });
    input = nextInput(run.state);
  }
  return run;
}

function resumed(run: StoredRun): { readonly milliseconds: number; readonly loaded: ReturnType<typeof loadedRunOf> } {
  const started = performance.now();
  const loaded = loadedRunOf({ snapshot: { snapshot: run.snapshot, bytes: run.snapshotBytes }, tail: run.tail });
  return { milliseconds: performance.now() - started, loaded };
}

describe(`a run of ${inputs} inputs`, () => {
  it('resumes from its last snapshot and the events after it alone, in about the time of one fold of a megabyte', () => {
    const run = ranToTheEnd();
    const { milliseconds, loaded } = resumed(run);

    expect(loaded.version).toBe(inputs);
    expect(loaded.state).toEqual(run.state);
    expect(run.tail.length).toBeLessThan(inputs / 50);
    expect(run.snapshotBytes).toBeLessThan(4096);
    expect(milliseconds).toBeLessThan(250);
  }, 60_000);
});
