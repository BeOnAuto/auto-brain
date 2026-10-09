import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { statement } from '../database/statement.ts';
import {
  alpha,
  at,
  cronTrigger,
  eventRecordOf,
  eventTrigger,
  everyTrigger,
  published,
  publishedInTurn,
  runRecorded,
  specRecordAt,
  specRecorded,
} from '../reaction-testing/brain-writes.ts';
import { startsReaching, untilScheduleRuns } from '../reaction-testing/kept-triggers.ts';
import { movedClock } from '../reaction-testing/moved-clock.ts';
import { reactingHost, type ReactingHost } from '../reaction-testing/reacting-host.ts';
import { until } from '../reaction-testing/until.ts';
import { reactionExecutionIdOf } from '../reactions/reaction-ids.ts';
import { mostStartsAMinute } from '../reactions/start-rates.ts';

const activatedAt = Date.parse(at);

const aMinute = 60_000;

const closed = eventTrigger({ type: 'com.acme.closed' });

function isoAt(minutes: number): string {
  return new Date(activatedAt + minutes * aMinute).toISOString();
}

async function openedAt(start: number) {
  const clock = movedClock(start);
  const reacting = await reactingHost({ clock });
  return { reacting, clock, starts: reacting.reactions.starts };
}

function closingSaved({ database }: ReactingHost, onEvents = closed) {
  return specRecorded(database.store, {
    name: 'close',
    version: 1,
    triggers: [onEvents, cronTrigger('30 9 * * *'), everyTrigger(15 * aMinute)],
  });
}

async function closingAt(start: number, onEvents = closed) {
  const opened = await openedAt(start);
  await closingSaved(opened.reacting, onEvents);
  return opened;
}

function closingStartedIn({ database }: ReactingHost, minute: number, starts: number) {
  return Effect.runPromise(
    database.write(
      statement`INSERT INTO workflow_reaction_rates (brain_key, workflow, minute, starts)
        VALUES (${alpha}, 'close', ${minute}, ${starts})`,
    ),
  );
}

function executionIdOf(start: { readonly executionId: string } | undefined): string {
  return start?.executionId ?? '';
}

describe('a workflow with an event trigger, a cron schedule and an every schedule', () => {
  it('starts one run for an event and one at each time each schedule is due, each naming its trigger and cause', async () => {
    const { reacting, clock } = await closingAt(activatedAt + 1000);
    const activation = specRecordAt(1);
    const event = eventRecordOf('e1');

    await published(reacting.database.store, { id: 'e1', type: 'com.acme.closed' });
    await startsReaching(reacting.reactions.starts, 1);
    clock.moveTo(activatedAt + 15 * aMinute);
    await startsReaching(reacting.reactions.starts, 2);
    clock.moveTo(activatedAt + 30 * aMinute);
    const starts = await startsReaching(reacting.reactions.starts, 4);

    expect(starts.map(({ executionId, trigger, cause, version }) => [executionId, trigger, cause, version])).toEqual([
      [
        reactionExecutionIdOf('close', 1, '/schedule/on', event),
        { kind: 'event', reference: '/schedule/on' },
        event,
        1,
      ],
      [
        reactionExecutionIdOf('close', 1, '/schedule/every', isoAt(15)),
        { kind: 'every', reference: '/schedule/every' },
        activation,
        1,
      ],
      [
        reactionExecutionIdOf('close', 1, '/schedule/cron', isoAt(30)),
        { kind: 'cron', reference: '/schedule/cron' },
        activation,
        1,
      ],
      [
        reactionExecutionIdOf('close', 1, '/schedule/every', isoAt(30)),
        { kind: 'every', reference: '/schedule/every' },
        activation,
        1,
      ],
    ]);
    expect(starts.slice(1).map(({ input }) => input)).toEqual([
      { schedule: { due: isoAt(15) } },
      { schedule: { due: isoAt(30) } },
      { schedule: { due: isoAt(30) } },
    ]);
  });
});

describe('a due time of a schedule asked for again', () => {
  it('is asked for under the same id, so the brain starts nothing again', async () => {
    const { reacting, clock } = await closingAt(activatedAt + 1000);
    clock.moveTo(activatedAt + 15 * aMinute);
    await startsReaching(reacting.reactions.starts, 1);
    await untilScheduleRuns(reacting.database, '/schedule/every');

    await Effect.runPromise(
      reacting.database.write(
        statement`UPDATE workflow_subscriptions SET next_due = ${activatedAt + 15 * aMinute}, running = NULL
          WHERE reference = '/schedule/every'`,
      ),
    );
    const [first, again] = await startsReaching(reacting.reactions.starts, 2);

    expect([again?.executionId, again?.input]).toEqual([first?.executionId, first?.input]);
  });
});

describe('the start rate of a workflow with several triggers', () => {
  it(`counts the starts of its event trigger to ${mostStartsAMinute} a minute, and never a start of its schedule`, async () => {
    const minute = activatedAt + 15 * aMinute;
    const { reacting } = await openedAt(minute + 1000);
    await closingStartedIn(reacting, minute, mostStartsAMinute - 1);
    await closingSaved(reacting);
    await startsReaching(reacting.reactions.starts, 1);

    await publishedInTurn(reacting.database.store, [
      { id: 'e1', type: 'com.acme.closed' },
      { id: 'e2', type: 'com.acme.closed' },
    ]);
    const starts = await startsReaching(reacting.reactions.starts, 2);
    const waiting = await until(
      () => Effect.runPromise(reacting.database.read(statement`SELECT execution_id FROM workflow_reaction_backlog`)),
      (rows) => rows.length > 0,
    );

    expect([starts.map(({ trigger }) => trigger.kind), waiting.length]).toEqual([['every', 'event'], 1]);
  });
});

describe('a workflow whose schedule started a run', () => {
  it('is not started by its own event trigger for that run, its facts, nor the events it emits', async () => {
    const told = eventTrigger({ type: 'com.acme.told' }, { type: 'execution_succeeded' });
    const { reacting, clock, starts: started } = await closingAt(activatedAt + 1000, told);
    await specRecorded(reacting.database.store, {
      name: 'watch',
      version: 1,
      triggers: [eventTrigger({ type: 'go' })],
    });
    clock.moveTo(activatedAt + 15 * aMinute);
    const [scheduled] = await startsReaching(started, 1);
    const run = executionIdOf(scheduled);
    const { store } = reacting.database;

    await runRecorded(store, { executionId: run, primitive: 'orchestration', name: 'close' }, 'execution_succeeded');
    await published(
      store,
      { id: 'told', type: 'com.acme.told' },
      {
        emitted_by: { execution_id: run, workflow: 'close', version: 1 },
        depth: 1,
      },
    );
    await published(store, { id: 'go', type: 'go' });
    const starts = await startsReaching(reacting.reactions.starts, 2);

    expect(starts.map(({ workflow, trigger }) => [workflow, trigger.kind])).toEqual([
      ['close', 'every'],
      ['watch', 'event'],
    ]);
  });
});
