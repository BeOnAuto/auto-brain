import { Effect } from 'effect';

import type { ArmTimer } from '../dispatch/run-output.ts';
import type { ArmedTimer, RunState } from '../machine/run-state.ts';
import { eventBytesOf } from '../run-log/run-event.ts';
import { isSnapshotDue, snapshotOf } from '../run-log/snapshot.ts';
import type { RunDecision } from './run-loop.ts';
import type { EnginePorts } from './workflow-engine.ts';

export function snapshotIfDue(ports: EnginePorts, decision: RunDecision): Effect.Effect<void> {
  const { sinceSnapshot } = decision.loaded;
  const bytes = decision.events.reduce((sum, event) => sum + eventBytesOf(event), sinceSnapshot.bytes);
  return isSnapshotDue({ bytes, snapshotBytes: sinceSnapshot.snapshotBytes })
    ? ports.runStore.saveSnapshot(snapshotOf(decision.state, decision.version))
    : Effect.void;
}

export function armedTimersOf(state: RunState): readonly ArmTimer[] {
  return Object.entries(state.timers.armed).map(([timerId, { dueAt, purpose }]: readonly [string, ArmedTimer]) => ({
    kind: 'arm_timer',
    executionId: state.executionId,
    timerId,
    dueAt,
    purpose,
  }));
}
