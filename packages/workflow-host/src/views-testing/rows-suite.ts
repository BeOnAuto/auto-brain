import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { oneRowOf, rowsOf } from '../database/host-database.ts';
import { reconciled, rowsOfBrain, type Reconciling } from '../projector/view-reconciling.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import { viewRowOf, ViewRowSchema, type ViewRow } from '../views/view-rows.ts';
import { foldedWritten, viewDropped, viewNamed, type FoldedRow } from '../views/view-statements.ts';
import { racingOnce } from './pool-faults.ts';
import { alphaKey, counting, detailsOf, liveAt, succeeded, viewTestTimeoutMs } from './view-documents.ts';
import { viewHarness, type ViewHarness } from './view-harness.ts';

const NameRow = Schema.Struct({ name: Schema.String });

function phasesOf(rows: readonly ViewRow[]): Readonly<Record<string, string>> {
  return Object.fromEntries(rows.map(({ name, phase }) => [name, phase]));
}

function reconciling(views: ViewHarness, rebuildsAtOnce: number): () => Promise<readonly ViewRow[]> {
  const parts: Reconciling = {
    database: views.store.database,
    definitionType: 'recollection',
    rebuildsAtOnce,
    definitions: new Map(),
  };
  return () => Effect.runPromise(reconciled(parts, alphaKey));
}

function written(views: ViewHarness, read: ViewRow, folded: Partial<FoldedRow>): Promise<number> {
  const next: FoldedRow = {
    view: 5,
    checkpoint: ['9'],
    checkpointAt: '2026-10-06T10:00:00.000Z',
    lastEvent: null,
    folded: 5,
    overtimes: 0,
    phase: read.phase,
    ...folded,
  };
  const took = rowsOf(NameRow, views.store.database.write(foldedWritten(read, next)));
  return Effect.runPromise(Effect.map(took, (rows) => rows.length));
}

function rowNamed(views: ViewHarness, name: string): Promise<ViewRow> {
  const read = oneRowOf(ViewRowSchema, views.store.database.read(viewNamed(alphaKey, name)));
  return Effect.runPromise(Effect.map(read, (row) => viewRowOf(row)));
}

function rowsOfAlpha(views: ViewHarness): Promise<readonly ViewRow[]> {
  return Effect.runPromise(rowsOfBrain(views.store.database, alphaKey));
}

function slotTests(settingsOf: SettingsOf): void {
  it('build as many views at once as there are slots, the others waiting in the order saved, a stalled one in none', async () => {
    const views = await viewHarness(await settingsOf());
    const reconcile = reconciling(views, 2);
    await views.saved('stalled', counting);
    await reconcile();
    const stalled = await written(views, await rowNamed(views, 'stalled'), { phase: 'stalled' });
    await views.saved('first', counting);
    await views.saved('second', counting);
    await views.saved('third', counting);

    const slotted = phasesOf(await reconcile());
    await views.saved('first', counting);
    const replaced = await reconcile();

    expect(stalled).toBe(1);
    expect(slotted).toEqual({ stalled: 'stalled', first: 'rebuilding', second: 'rebuilding', third: 'waiting' });
    expect(phasesOf(replaced)).toEqual({
      stalled: 'stalled',
      second: 'rebuilding',
      third: 'rebuilding',
      first: 'waiting',
    });
    expect(replaced.find(({ name }) => name === 'first')?.version).toBe(2);
  });

  it('keep none for a version whose details it cannot read', async () => {
    const views = await viewHarness(await settingsOf());
    const content = { source: 'a document saved before views were kept' };
    const event = {
      type: 'spec_created',
      name: 'older',
      version: 1,
      content,
      by: 'acme-admin',
      at: '2026-10-06T09:00:00.000Z',
    };
    await views.append(`${alphaKey}specs/recollection`, [{ type: 'spec_created', data: event }]);
    await views.saved('runs', counting);

    const rows = await reconciling(views, 4)();

    expect(rows.map(({ name }) => name)).toEqual(['runs']);
  });
}

function conditionalWriteTests(settingsOf: SettingsOf): void {
  it('take no write from a host that read a row before another wrote it or a newer version reset it', async () => {
    const views = await viewHarness(await settingsOf());
    const reconcile = reconciling(views, 4);
    await views.saved('runs', counting);
    await reconcile();
    const row = await rowNamed(views, 'runs');

    const first = await written(views, row, {});
    const stale = await written(views, row, { view: 99 });
    await views.saved('runs', counting);
    const [renewed] = await reconcile();
    const afterReset = await written(views, { ...row, checkpointText: '' }, { view: 99 });

    expect([first, stale, afterReset]).toEqual([1, 0, 0]);
    expect(renewed).toMatchObject({ version: 2, view: 0, folded: 0, checkpointText: '' });
  });

  it('never makes a dropped row again by a write', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('runs', counting);
    await reconciling(views, 4)();
    const row = await rowNamed(views, 'runs');
    await Effect.runPromise(views.store.database.write(viewDropped(alphaKey, 'runs')));

    expect([await written(views, row, {}), await rowsOfAlpha(views)]).toEqual([0, []]);
  });
}

function racingTests(settingsOf: SettingsOf): void {
  it('let a page go whose row another host renewed while it folded, and fold the newer version from the start', async () => {
    const views = await viewHarness(await settingsOf());
    const elsewhere = reconciling(views, 4);
    await views.saved('runs', detailsOf('. + 100', succeeded, { initial: 0 }));
    await views.ranEach('inference/runs', [1, 2]);
    const renewedElsewhere = async (): Promise<void> => {
      await views.saved('runs', counting);
      await elsewhere();
    };
    views.start({ pool: racingOnce(views.pool, renewedElsewhere) });

    const kept = await views.until('runs', liveAt(2));

    expect(kept).toMatchObject({ view: 2, folded: 2 });
  });
}

export function rowsSuite(settingsOf: SettingsOf): void {
  describe('the rows of the views', { timeout: viewTestTimeoutMs }, () => {
    slotTests(settingsOf);
    conditionalWriteTests(settingsOf);
    racingTests(settingsOf);
  });
}
