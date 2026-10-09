import { lastEndingOf, runEndingOf, type CalledBy, type RunEnding } from '@beonauto/definitions';
import { streamPrefixOfBrain, type BrainAddress, type CallResult, type Conflict } from '@beonauto/operations';
import { callKeyText, type RunInput, type Submission } from '@beonauto/workflow-engine';
import { Effect } from 'effect';

import { answeredRow, callRowOf, deliveredRow, waitingCallsOf } from '../calls/call-rows.ts';
import type { HostDatabase } from '../database/host-database.ts';
import { DeliveryFailed, type CallConsumer } from '../follower/consumers.ts';
import { addressOfRun, runKeyOf } from '../runs/run-address.ts';
import type { WaitingOptions } from './waiting-options.ts';

export interface EndingParts {
  readonly database: HostDatabase;
  readonly submitted: (input: RunInput) => Effect.Effect<Submission, Conflict>;
  readonly resultOf: WaitingOptions['resultOf'];
  readonly now: () => number;
}

interface CalledEnding {
  readonly ending: RunEnding;
  readonly calledBy: CalledBy;
}

function calledEndingOf(ending: RunEnding | undefined): CalledEnding | undefined {
  const calledBy = ending?.called_by;
  return ending === undefined || calledBy === undefined ? undefined : { ending, calledBy };
}

function failedWith({ detail }: Readonly<{ detail: string }>): DeliveryFailed {
  return new DeliveryFailed({ detail });
}

function answeredWith(parts: EndingParts, brain: BrainAddress, { ending, calledBy }: CalledEnding) {
  const runId = runKeyOf({ ...brain, runId: calledBy.run_id });
  const key = { runId, reference: calledBy.reference, run: calledBy.run };
  const result = parts.resultOf(ending);
  const answered = parts
    .submitted({ kind: 'call_answered', runId, at: parts.now(), key, result })
    .pipe(
      Effect.andThen(answeredRow(parts.database, callKeyText(key), result)),
      Effect.andThen(deliveredRow(parts.database, callKeyText(key))),
    );
  return callRowOf(parts.database, callKeyText(key)).pipe(
    Effect.flatMap((row) => (row?.state === 'waiting' ? answered : Effect.void)),
    Effect.mapError(failedWith),
  );
}

function childEndingOf(database: HostDatabase, brain: BrainAddress, child: string) {
  const stream = `${streamPrefixOfBrain(brain)}runs/${child}`;
  return Effect.map(
    Effect.promise(() => database.store.read(stream, 0)),
    ({ events }) => calledEndingOf(lastEndingOf(events)),
  );
}

export function childAnswersOn(
  database: HostDatabase,
  resultOf: WaitingOptions['resultOf'],
): (runKey: string, child: string) => Effect.Effect<CallResult | undefined> {
  return (runKey, child) => {
    const { org, brain } = addressOfRun(runKey);
    return Effect.map(childEndingOf(database, { org, brain }, child), (called) =>
      called === undefined ? undefined : resultOf(called.ending),
    );
  };
}

export function childEndings(parts: EndingParts): CallConsumer {
  return {
    name: 'child_endings',
    types: ['run_succeeded', 'run_rejected', 'run_failed'],
    skippedAfterSweeps: Number.POSITIVE_INFINITY,
    batchOf: ({ brain, record }, after) =>
      Effect.sync(() => {
        const called = after === undefined ? calledEndingOf(runEndingOf(record.data)) : undefined;
        return {
          deliveries:
            called === undefined
              ? []
              : [{ key: 'call', workflow: called.calledBy.run_id, deliver: answeredWith(parts, brain, called) }],
          through: undefined,
          more: false,
        };
      }),
    skipped: () => Effect.void,
  };
}

export function endedChildrenOn(parts: EndingParts): (runKey: string) => Effect.Effect<void, DeliveryFailed> {
  const { database } = parts;
  return (runKey) =>
    Effect.gen(function* () {
      const { org, brain } = addressOfRun(runKey);
      const waiting = yield* Effect.mapError(waitingCallsOf(database, runKey), failedWith);
      for (const { child } of waiting) {
        const called = yield* childEndingOf(database, { org, brain }, child);
        if (called !== undefined) {
          yield* answeredWith(parts, { org, brain }, called);
        }
      }
    });
}
