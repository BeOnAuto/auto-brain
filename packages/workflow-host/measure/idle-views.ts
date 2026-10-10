import { setTimeout } from 'node:timers/promises';

import { programPool, unitMemoryBytes, workerStackBytes } from '@beonauto/workflow-engine/dsl';
import { Effect, Function } from 'effect';

import type { DatabaseSettings } from '../src/database/host-databases.ts';
import { statement } from '../src/database/statement.ts';
import { openWorkflowStore, type WorkflowStore } from '../src/host/workflow-store.ts';
import { systemClock } from '../src/loop/host-clock.ts';
import { startProjector } from '../src/projector/projector.ts';

export interface IdleViews {
  readonly views: number;
  readonly viewBytes: number;
  readonly seconds: number;
  readonly busyMsASecond: number;
}

const brain = 'brain/acme/alpha/';

const details = {
  language: 'typescript',
  fold: 'export function fold(view: number): number {\n  return view + 1;\n}',
  foldLine: 7,
  filters: [{ type: 'com.acme.never' }],
  initial: 0,
};

function saved(index: number) {
  const name = `view-${index}`;
  const data = {
    type: 'definition_created',
    name,
    version: 1,
    content: { source: name, details },
    by: 'acme-admin',
    at: '2026-10-06T09:00:00.000Z',
  };
  return { type: 'definition_created', data };
}

async function allLive(store: WorkflowStore, views: number): Promise<void> {
  const kept = await Promise.all(
    Array.from({ length: views }, (_, index) =>
      Effect.runPromise(store.views.viewOf({ org: 'acme', brain: 'alpha' }, `view-${index}`)),
    ),
  );
  if (kept.every((view) => view?.phase === 'live')) {
    return;
  }
  await setTimeout(50);
  await allLive(store, views);
}

export async function idleViewsOn(settings: DatabaseSettings, views: number, seconds: number): Promise<IdleViews> {
  const store = await openWorkflowStore(settings, Function.constVoid);
  await store.database.store.append(
    `${brain}definitions/recall`,
    Array.from({ length: views }, (_, index) => saved(index)),
    0,
  );
  const pool = programPool({ workers: 4, heapMegabytes: 256 });
  const projector = startProjector({
    database: store.database,
    settings: {
      definitionType: 'recall',
      pool,
      folding: {
        budget: 500,
        memoryBytes: unitMemoryBytes,
        stackBytes: workerStackBytes,
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
  await allLive(store, views);
  const view = JSON.stringify(Array.from({ length: 5000 }, (_, index) => ({ at: index, verdict: 'x'.repeat(80) })));
  await Effect.runPromise(store.database.write(statement`UPDATE recall_views SET view = ${view}`));
  const before = performance.eventLoopUtilization();
  await setTimeout(seconds * 1000);
  const busy = performance.eventLoopUtilization(before);
  await projector.stop();
  await pool.close();
  await store.database.close();
  return { views, viewBytes: view.length, seconds, busyMsASecond: busy.utilization * 1000 };
}
