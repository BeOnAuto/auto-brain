import { setTimeout } from 'node:timers/promises';

import { Effect, Function, Semaphore } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import type { HostDatabase } from '../database/host-database.ts';
import { onSQLite } from '../testing/host-files.ts';
import { heldFolds, heldReads } from '../views-testing/pool-faults.ts';
import * as documents from '../views-testing/view-documents.ts';
import { viewHarness, type ViewHarness } from '../views-testing/view-harness.ts';
import { brainPass, type PassParts } from './brain-pass.ts';
import { rowsOfBrain } from './view-reconciling.ts';

const { alpha, alphaKey, counting, detailsOf, foldedAll, foldingOf, isLive, liveWith, succeeded, viewTestTimeoutMs } =
  documents;

const brains = [alpha, { org: 'acme', brain: 'beta' }, { org: 'acme', brain: 'gamma' }];

async function overtimesOf(views: ViewHarness, name: string): Promise<number | undefined> {
  const rows = await Effect.runPromise(rowsOfBrain(views.store.database, alphaKey));
  return rows.find((row) => row.name === name)?.overtimes;
}

async function viewsInEveryBrain(views: ViewHarness): Promise<void> {
  await Promise.all(
    brains.map(async (brain) => {
      await views.saved('runs', counting, brain);
      await views.ran('inference/runs', 1, { brain });
    }),
  );
}

function partsOf(views: ViewHarness, database: HostDatabase, pagesPerWake: number): PassParts {
  return {
    database,
    note: () => Effect.void,
    settings: views.settingsOf({ pagesPerWake, folding: { ...foldingOf(), pageBudgetMs: 60_000 } }),
    share: Semaphore.makeUnsafe(2),
    reconciling: { database, definitionType: 'recollection', rebuildsAtOnce: 4, definitions: new Map() },
    resting: { isResting: () => false, rest: Function.constVoid },
    firstSeen: () => true,
    trouble: () => Effect.void,
  };
}

describe('the pages of a pass', { timeout: viewTestTimeoutMs }, () => {
  it('reads at most the pages a pass may, and asks for another pass', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    await views.ranInOneStream(
      'inference/runs',
      Array.from({ length: 2500 }, (_, run) => run),
    );
    const reads = heldReads(views.store.database);
    reads.open();

    const more = await Effect.runPromise(brainPass(partsOf(views, reads.gated, 2), alphaKey));
    const kept = await views.viewOf('runs');

    expect([more, reads.total(), kept?.folded]).toEqual([true, 2, 1999]);
  });
});

describe('the share of a projector', { timeout: viewTestTimeoutMs }, () => {
  it('passes at most as many brains at once as it may', async () => {
    const views = await viewHarness(await onSQLite());
    await viewsInEveryBrain(views);
    const reads = heldReads(views.store.database);
    views.start({ through: () => reads.gated, brainsAtOnce: 2 });

    await vi.waitFor(
      () => {
        expect(reads.waiting()).toBe(2);
      },
      { timeout: 10_000 },
    );
    await setTimeout(300);
    const most = reads.most();
    reads.open();
    await Promise.all(brains.map((brain) => views.until('runs', liveWith(1), brain)));

    expect(most).toBe(2);
  });

  it('folds in at most half the workers of the pool at once', async () => {
    const views = await viewHarness(await onSQLite());
    await viewsInEveryBrain(views);
    const folds = heldFolds(views.pool);
    views.start({ pool: folds.gated });

    await vi.waitFor(
      () => {
        expect(folds.waiting()).toBe(2);
      },
      { timeout: 10_000 },
    );
    await setTimeout(300);
    const most = folds.most();
    folds.open();
    await Promise.all(brains.map((brain) => views.until('runs', liveWith(1), brain)));

    expect([views.pool.workers, most]).toEqual([4, 2]);
  });
});

describe('a fold that ran past its deadline', { timeout: viewTestTimeoutMs }, () => {
  it('is tried again at the next sweep, not the next page, while the other views of its brain go on', async () => {
    const views = await viewHarness(await onSQLite());
    const slowOnce = 'if $event.data.output == "slow" then reduce range(3000000) as $i (.; . + 0) else . + 1 end';
    await views.saved('slow', detailsOf(slowOnce, succeeded, { initial: 0 }));
    await views.saved('quick', counting);
    views.start({ folding: { ...foldingOf(), foldDeadlineMs: 1 }, sweepEveryMs: 10_000 });
    await Promise.all([views.until('slow', isLive), views.until('quick', isLive)]);

    await views.ran('inference/runs', 'slow');
    await vi.waitFor(
      async () => {
        expect(await overtimesOf(views, 'slow')).toBe(1);
      },
      { timeout: 8000 },
    );
    await views.ran('inference/runs', 'quick');
    await views.until('quick', foldedAll(2));
    const beforeTheSweep = await overtimesOf(views, 'slow');
    await vi.waitFor(
      async () => {
        expect(await overtimesOf(views, 'slow')).toBe(2);
      },
      { timeout: 25_000 },
    );

    expect(beforeTheSweep).toBe(1);
  });
});
