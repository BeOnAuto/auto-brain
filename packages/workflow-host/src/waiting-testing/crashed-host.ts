import { testMachine } from '@beonauto/workflow-engine/testing';
import { Effect, Function } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { hostEngineOn } from '../host/host-engine.ts';
import type { RunStart } from '../host/run-requests.ts';
import { systemClock } from '../loop/host-clock.ts';
import { recordedReactions } from '../reaction-testing/recorded-reactions.ts';
import { recordingReports, recordingSettlements } from '../testing/recording-reports.ts';
import { executorWaitingOf } from '../waiting/waiting-parts.ts';
import { recordedWaiting } from './recorded-waiting.ts';

export async function startedByAHostThatDied(database: HostDatabase, runId: string, start: RunStart): Promise<void> {
  const engine = hostEngineOn(
    database,
    {
      machine: testMachine,
      perform: Function.constant(Effect.never),
      settle: recordingSettlements(Function.constFalse).settle,
      reports: recordingReports().reports,
      mostCallsAtOnce: 4,
      clock: systemClock,
      reactions: recordedReactions().options,
    },
    executorWaitingOf(database, testMachine, recordedWaiting().options),
    Function.constVoid,
  );
  await Effect.runPromise(engine.submitted({ ...start, kind: 'started', executionId: runId, at: Date.now() }));
}
