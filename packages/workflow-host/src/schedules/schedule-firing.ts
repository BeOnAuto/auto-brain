import { Effect, Schema } from 'effect';

import { rowsOf, WholeNumber, type HostDatabase } from '../database/host-database.ts';
import { statement } from '../database/statement.ts';
import { reactionExecutionIdOf } from '../reactions/reaction-ids.ts';
import type { StartReaction } from '../reactions/reaction-options.ts';
import type { Refusals } from '../reactions/refusals.ts';
import { dueSchedules, nextScheduleDue, scheduleMovedOn, type Schedule } from './schedule-rows.ts';
import { latestDue, nextAfter } from './schedule-times.ts';

export interface ScheduleFiring {
  readonly fireDue: () => Effect.Effect<number>;
  readonly nextDueAt: () => Effect.Effect<number | null>;
}

interface FiringParts {
  readonly database: HostDatabase;
  readonly start: StartReaction;
  readonly refusals: Refusals;
  readonly now: () => number;
}

interface Firing {
  readonly subscription: Schedule;
  readonly next: number | null;
  readonly latest: number;
}

const schedulesInOneFiring = 64;

const EndedRow = Schema.Struct({ ended_at: Schema.NullOr(WholeNumber) });

function brainOf(brainKey: string): { readonly org: string; readonly brain: string } {
  const [, org = '', brain = ''] = brainKey.split('/');
  return { org, brain };
}

function dueAtOf({ latest }: Firing): string {
  return new Date(latest).toISOString();
}

function stillRuns(database: HostDatabase, brainKey: string, running: string | null): Effect.Effect<boolean> {
  if (running === null) {
    return Effect.succeed(false);
  }
  const { org, brain } = brainOf(brainKey);
  return Effect.orDie(
    rowsOf(
      EndedRow,
      database.read(statement`SELECT ended_at FROM workflow_runs WHERE run_id = ${`${org}/${brain}/${running}`}`),
    ),
  ).pipe(Effect.map(([row]) => row !== undefined && row.ended_at === null));
}

function skipped({ database, refusals }: FiringParts, firing: Firing) {
  const { subscription, next } = firing;
  return Effect.andThen(
    refusals.refuse(
      subscription.brainKey,
      subscription.workflow,
      `The run due at ${dueAtOf(firing)} was skipped: the run of the time before still runs`,
    ),
    scheduleMovedOn(database, subscription, next, subscription.running),
  );
}

function missedSaid({ refusals }: FiringParts, firing: Firing) {
  const { subscription, latest } = firing;
  return latest > subscription.nextDue
    ? refusals.refuse(
        subscription.brainKey,
        subscription.workflow,
        `The runs due from ${new Date(subscription.nextDue).toISOString()} to ${dueAtOf(firing)} came while the server was down, and only the latest ran`,
      )
    : Effect.void;
}

function ran(parts: FiringParts, firing: Firing) {
  const { brainKey, workflow, version } = firing.subscription;
  const due = dueAtOf(firing);
  const executionId = reactionExecutionIdOf(workflow, version, due);
  const input = { schedule: { due } };
  return parts.start({ ...brainOf(brainKey), workflow, version, executionId, input, depth: 1, cause: null }).pipe(
    Effect.andThen(
      Effect.andThen(
        scheduleMovedOn(parts.database, firing.subscription, firing.next, executionId),
        missedSaid(parts, firing),
      ),
    ),
    Effect.catch(({ detail }: Readonly<{ detail: string }>) =>
      Effect.andThen(
        parts.refusals.refuse(brainKey, workflow, `The run due at ${due} could not be started: ${detail}`),
        scheduleMovedOn(parts.database, firing.subscription, firing.next, null),
      ),
    ),
  );
}

function fired(parts: FiringParts, subscription: Schedule) {
  const at = parts.now();
  const { timing, activatedAt, nextDue } = subscription;
  const firing: Firing = {
    subscription,
    next: nextAfter(timing, activatedAt, at),
    latest: latestDue(timing, activatedAt, nextDue, at),
  };
  return Effect.flatMap(stillRuns(parts.database, subscription.brainKey, subscription.running), (runs) =>
    runs ? skipped(parts, firing) : ran(parts, firing),
  );
}

export function scheduleFiringOn(
  database: HostDatabase,
  start: StartReaction,
  refusals: Refusals,
  now: () => number,
): ScheduleFiring {
  const parts: FiringParts = { database, start, refusals, now };
  return {
    fireDue: () =>
      Effect.gen(function* () {
        const due = yield* dueSchedules(database, now(), schedulesInOneFiring);
        yield* Effect.forEach(due, (subscription) => fired(parts, subscription), { discard: true });
        return due.length;
      }),
    nextDueAt: () => nextScheduleDue(database),
  };
}
