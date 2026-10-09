import { setTimeout } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { eventually } from '../testing/eventually.ts';
import { onSQLite } from '../testing/host-files.ts';
import { busyOnce } from '../views-testing/pool-faults.ts';
import {
  collecting,
  counting,
  foldOf,
  foldedAll,
  foldingOf,
  isStalled,
  viewTestTimeoutMs,
} from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';
import type { StallCause } from '../views/view-rows.ts';

function workerOf(source: string): URL {
  return new URL(`data:text/javascript,${encodeURIComponent(source)}`);
}

function markingThen(event: number, then: string): string {
  return `import { parentPort } from "node:worker_threads"; parentPort.on("message", ({ progress }) => { const place = new Int32Array(progress); Atomics.store(place, 0, ${event}); Atomics.store(place, 1, 0); ${then} });`;
}

const quick = {
  folding: { ...foldingOf(), foldDeadlineMs: 1, pageBudgetMs: 1 },
  overtimesBeforeStall: 2,
  sweepEveryMs: 20,
};

const workersThatStop: readonly (readonly [string, string, StallCause, string])[] = [
  [
    'stops at its deadline',
    markingThen(0, 'while (true) {}'),
    'time',
    'The fold was stopped by its deadline of 1 ms 2 times',
  ],
  [
    'runs out of memory',
    markingThen(0, 'const kept = []; while (true) { kept.push(new Array(100000).fill(kept.length)); }'),
    'memory',
    'The fold was stopped by its memory 2 times',
  ],
  [
    'crashes',
    markingThen(0, 'throw new Error("broken on purpose");'),
    'crash',
    'The fold was stopped by its crash 2 times',
  ],
];

const workersThatNameNoFold: readonly (readonly [string, string, string])[] = [
  [
    'crashes before it names a fold',
    'throw new Error("before any fold");',
    'A page of folds crashed before it named a fold: The worker failed: before any fold',
  ],
  [
    'is stopped by its deadline before it names a fold',
    'while (true) {}',
    'A page of folds was stopped by its deadline before it named a fold',
  ],
  [
    'answers what the projector cannot read',
    'import { parentPort } from "node:worker_threads"; parentPort.on("message", ({ job }) => { parentPort.postMessage({ job, answer: { ran: "unreadable" }, keep: false }); });',
    'A worker answered a page of folds with something it could not read',
  ],
];

describe('a page of folds the pool cannot finish', { timeout: viewTestTimeoutMs }, () => {
  it.each(workersThatStop)(
    'counts against the fold that was going when it %s, and stalls it after its tries',
    async (_way, source, kind, message) => {
      const views = await viewHarness(await onSQLite(), { foldWorker: workerOf(source), heapMegabytes: 16 });
      await views.saved('runs', counting);
      await views.ran('reasoning/runs', 1);
      views.start(quick);

      const kept = await views.until('runs', isStalled);

      expect(kept).toMatchObject({ view: 0, folded: 0, stall: { kind, message, line: null } });
    },
  );

  it.each(workersThatNameNoFold)(
    'is reported and tried again, counting against no fold, when its worker %s',
    async (_way, source, trouble) => {
      const views = await viewHarness(await onSQLite(), { foldWorker: workerOf(source) });
      await views.saved('runs', counting);
      await views.ran('reasoning/runs', 1);
      views.start(quick);

      const troubles = await eventually(views.reports.troubles, (reported) => reported.length > 1, 3000);
      const kept = await views.viewOf('runs');

      expect(kept).toMatchObject({ phase: 'rebuilding', folded: 0 });
      expect(troubles.slice(0, 2)).toEqual([trouble, trouble]);
    },
  );

  it('is tried again, with nothing reported, when the pool has no worker free for it', async () => {
    const views = await viewHarness(await onSQLite());
    await views.saved('runs', counting);
    await views.ran('reasoning/runs', 1);
    const busy = busyOnce(views.pool);
    views.start({ pool: busy.pool });

    const kept = await views.until('runs', foldedAll(1));

    expect([kept.view, busy.folds(), views.reports.troubles()]).toEqual([1, 2, []]);
  });
});

describe('a page of folds lost twice', { timeout: viewTestTimeoutMs }, () => {
  it('counts a try and keeps the checkpoint when what it folds before the event breaks its worker too', async () => {
    const atTheSecondRun = markingThen(2, 'throw new Error("broken on purpose");');
    const views = await viewHarness(await onSQLite(), { foldWorker: workerOf(atTheSecondRun) });
    await views.saved('runs', counting);
    await views.ranEach('reasoning/runs', [1, 2]);
    views.start(quick);

    const kept = await views.until('runs', isStalled);

    expect(kept).toMatchObject({
      view: 0,
      folded: 0,
      checkpoint: null,
      stall: { kind: 'crash', message: 'The fold was stopped by its crash 2 times' },
    });
  });
});

describe('a projector stopped while it folds', { timeout: viewTestTimeoutMs }, () => {
  it('repeats the page when it starts again, and writes each fold once', async () => {
    const settings = await onSQLite();
    const slow = {
      ...collecting,
      fold: foldOf(
        'let spent = 0;\n  for (let index = 0; index < 10_000_000; index++) spent += index;\n  return [...view, event.data.output];',
        'unknown[]',
      ),
    };
    const lifted = { folding: { ...foldingOf(), budget: 1_000_000 } };
    const first = await viewHarness(settings);
    await first.saved('outputs', slow);
    await first.ranEach('reasoning/runs', [1, 2, 3]);
    const stopping = first.start(lifted);
    await setTimeout(150);
    await stopping.stop();
    const interrupted = await first.viewOf('outputs');

    const second = await viewHarness(settings);
    second.start(lifted);
    const kept = await second.until('outputs', foldedAll(3));

    expect(interrupted?.folded).toBeLessThan(3);
    expect(kept.view).toEqual([1, 2, 3]);
  });
});
