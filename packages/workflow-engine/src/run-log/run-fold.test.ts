import { describe, expect, it } from 'vitest';

import {
  evolveRun,
  loadedRunOf,
  newRun,
  stateFormat,
  StreamGap,
  type PositionedEvent,
  type RunEvent,
  type Snapshot,
  type StatePatch,
} from '../index.ts';
import { at, document, executionId } from '../testing/runs.ts';

const timer = `${executionId}/timers/1`;

function applied(version: number, bytes: number, patch: StatePatch): PositionedEvent {
  const event: RunEvent = {
    type: 'input_applied',
    format: stateFormat,
    receipt: { kind: 'timer_fired', key: timer, at },
    steps: [],
    patch,
    outputs: [],
  };
  return { version, bytes, event };
}

const startedRun = applied(1, 900, [
  { op: 'replace', path: '/executionId', value: executionId },
  { op: 'replace', path: '/status', value: 'running' },
  { op: 'replace', path: '/workflow', value: { document, input: 1 } },
  { op: 'add', path: '/machine/values/1', value: { value: { ticket: 7 }, bytes: 12, holders: 1 } },
  { op: 'replace', path: '/inputs', value: 1 },
  { op: 'replace', path: '/startedAt', value: at },
  { op: 'replace', path: '/lastInputAt', value: at },
]);

const armed = applied(2, 300, [
  {
    op: 'add',
    path: `/timers/armed/${timer.replaceAll('/', '~1')}`,
    value: { purpose: 'wait', reference: '/do/0', dueAt: at + 1000 },
  },
  { op: 'replace', path: '/timers/next', value: 2 },
  { op: 'replace', path: '/inputs', value: 2 },
]);

const fired = applied(3, 200, [
  { op: 'remove', path: `/timers/armed/${timer.replaceAll('/', '~1')}` },
  { op: 'replace', path: '/machine/context', value: 1 },
  { op: 'replace', path: '/inputs', value: 3 },
  { op: 'replace', path: '/lastInputAt', value: at + 1000 },
]);

describe('a run loaded from its stream', () => {
  it('is the fold of its events from a new run, with its version and the bytes of its history', () => {
    const loaded = loadedRunOf({ snapshot: null, tail: [startedRun, armed, fired] });

    expect(loaded).toMatchObject({
      version: 3,
      historyBytes: 1400,
      sinceSnapshot: { inputs: 3, bytes: 1400, snapshotBytes: 0 },
      state: { executionId, status: 'running', inputs: 3, lastInputAt: at + 1000, timers: { next: 2, armed: {} } },
    });
    expect(loadedRunOf({ snapshot: null, tail: [] }).state).toEqual(newRun);
  });

  it('is the same from its latest snapshot and the events after it as from its whole stream', () => {
    const atTwo = loadedRunOf({ snapshot: null, tail: [startedRun, armed] });
    const snapshot: Snapshot = {
      format: stateFormat,
      executionId,
      version: 2,
      historyBytes: atTwo.historyBytes,
      state: atTwo.state,
    };

    const fromSnapshot = loadedRunOf({ snapshot: { snapshot, bytes: 5000 }, tail: [fired] });

    expect(fromSnapshot).toEqual({
      ...loadedRunOf({ snapshot: null, tail: [startedRun, armed, fired] }),
      sinceSnapshot: { inputs: 1, bytes: 200, snapshotBytes: 5000 },
    });
    expect(evolveRun(atTwo.state, fired.event)).toEqual(fromSnapshot.state);
  });

  it('dies on a gap in its events, and on a patch that leaves a state this format does not describe', () => {
    expect(() => loadedRunOf({ snapshot: null, tail: [startedRun, fired] })).toThrow(
      new StreamGap({ expected: 2, found: 3 }),
    );
    expect(() =>
      evolveRun(newRun, applied(1, 10, [{ op: 'replace', path: '/status', value: 'paused' }]).event),
    ).toThrow(/Expected "new" \| "running" \| "ended"/u);
  });
});
