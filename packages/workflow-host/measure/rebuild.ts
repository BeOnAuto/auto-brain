import { setTimeout } from 'node:timers/promises';

import { liftedLimits, programPool } from '@beonauto/workflow-engine/dsl';
import { Effect, Function } from 'effect';

import type { HostDatabase } from '../src/database/host-database.ts';
import type { DatabaseSettings } from '../src/database/host-databases.ts';
import { openWorkflowStore } from '../src/host/workflow-store.ts';
import { systemClock } from '../src/loop/host-clock.ts';
import { startProjector } from '../src/projector/projector.ts';

export interface Rebuild {
  readonly events: number;
  readonly pages: number;
  readonly writes: number;
  readonly milliseconds: number;
  readonly viewBytes: number;
}

const brain = 'brain/acme/alpha/';

const runsInAStream = 100;

const reviewsFold = [
  '($event.data.output | if type == "object" then .campaign else null end | if type == "string" then . else "unknown" end) as $campaign',
  '| .[$campaign] += [{ at: $event.time, verdict: ($event.data.output.verdict? // "none" | tostring | .[0:200]), run: $event.source }]',
  '| .[$campaign] |= .[-20:]',
  '| to_entries | sort_by(.value[-1].at) | .[-50:] | from_entries',
].join('\n');

const details = {
  language: 'jq',
  fold: reviewsFold,
  foldLine: 15,
  filters: [{ type: 'run_succeeded', subject: 'reasoning/review-brief' }],
  initial: {},
};

function succeeded(index: number) {
  const at = new Date(Date.UTC(2026, 9, 6) + index * 1000).toISOString();
  const output = { campaign: `campaign-${index % 100}`, verdict: index % 3 === 0 ? 'reject' : 'approve' };
  const data = {
    type: 'run_succeeded',
    definition_type: 'reasoning',
    name: 'review-brief',
    definition_version: 1,
    output,
    record: {},
    by: 'acme-admin',
    at,
  };
  return { type: 'run_succeeded', data };
}

async function recorded(database: HostDatabase, events: number): Promise<void> {
  const streams = Array.from({ length: events / runsInAStream }, (_, stream) => stream);
  await streams.reduce<Promise<void>>(
    (before, stream) =>
      before.then(() =>
        database.store.append(
          `${brain}runs/0199a3c4-7d2e-7c1a-9b3f-${String(stream).padStart(12, '0')}`,
          Array.from({ length: runsInAStream }, (_, run) => succeeded(stream * runsInAStream + run)),
          0,
        ),
      ),
    Promise.resolve(),
  );
  const saved = {
    type: 'definition_created',
    name: 'reviews',
    version: 1,
    content: { source: 'reviews', details },
    by: 'acme-admin',
    at: '2026-10-06T09:00:00.000Z',
  };
  await database.store.append(`${brain}definitions/recall`, [{ type: 'definition_created', data: saved }], 0);
}

interface Counted {
  readonly database: HostDatabase;
  readonly pages: () => number;
  readonly writes: () => number;
}

function counted(database: HostDatabase): Counted {
  const counts = { pages: 0, writes: 0 };
  return {
    database: {
      ...database,
      write: (statement) => {
        counts.writes += statement.strings[0]?.startsWith('UPDATE recall_views SET view') === true ? 1 : 0;
        return database.write(statement);
      },
      store: {
        ...database.store,
        readRecorded: (brainKey, selection, page) => {
          counts.pages += 1;
          return database.store.readRecorded(brainKey, selection, page);
        },
      },
    },
    pages: () => counts.pages,
    writes: () => counts.writes,
  };
}

export async function rebuildOn(settings: DatabaseSettings, events: number): Promise<Rebuild> {
  const store = await openWorkflowStore(settings, Function.constVoid);
  await recorded(store.database, events);
  const pool = programPool({ workers: 4, heapMegabytes: 256 });
  const counting = counted(store.database);
  const started = performance.now();
  const projector = startProjector({
    database: counting.database,
    settings: {
      definitionType: 'recall',
      pool,
      folding: {
        dialect: { refused: [], variables: ['event'] },
        variable: 'event',
        limits: liftedLimits(16_000_000),
        foldDeadlineMs: 10_000,
        pageBudgetMs: 2000,
        mostViewBytes: 524_288,
      },
      brainsAtOnce: 4,
      rebuildsAtOnce: 4,
      pagesPerWake: 10,
      overtimesBeforeStall: 20,
    },
    reports: {
      unsettled: () => Effect.void,
      trouble: () => Effect.void,
      lostConnection: Function.constVoid,
      note: () => Effect.void,
    },
    clock: systemClock,
    sweepEveryMs: 1000,
  });
  const kept = await liveAfter(store, events);
  const milliseconds = performance.now() - started;
  await projector.stop();
  await pool.close();
  await store.database.close();
  return {
    events,
    pages: counting.pages(),
    writes: counting.writes(),
    milliseconds,
    viewBytes: JSON.stringify(kept).length,
  };
}

async function liveAfter(store: Awaited<ReturnType<typeof openWorkflowStore>>, events: number): Promise<unknown> {
  const kept = await Effect.runPromise(store.views.viewOf({ org: 'acme', brain: 'alpha' }, 'reviews'));
  if (kept?.phase === 'live' && kept.folded === events) {
    return kept.view;
  }
  await setTimeout(50);
  return liveAfter(store, events);
}
