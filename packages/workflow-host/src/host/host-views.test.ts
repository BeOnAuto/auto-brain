import { Effect, Function } from 'effect';
import { describe, expect, it } from 'vitest';

import { tallyFolderOf } from '../folder-testing/tally-folder.ts';
import { someFolder } from '../projector/folder.ts';
import { onSQLite, openedOn } from '../testing/host-files.ts';
import { hostedOn } from '../testing/host-runs.ts';
import { counting } from '../views-testing/view-documents.ts';
import { viewHarness } from '../views-testing/view-harness.ts';
import { watchedSystemClock } from '../views-testing/watched-clock.ts';
import { openWorkflowStore } from './workflow-store.ts';

describe('a host given a store and the settings of its projector', () => {
  it('keeps the views of recall functions on that store while it serves, and stops keeping them when it stops', async () => {
    const settings = await onSQLite();
    const views = await viewHarness(settings);
    await views.saved('runs', counting);
    await views.ran('reasoning/runs', 1);
    const projector = views.settingsOf();
    const store = await openWorkflowStore(settings, Function.constVoid, projector.folders);

    const clock = watchedSystemClock();
    const hosted = await hostedOn(store, { projector, clock });
    const kept = await views.until('runs', ({ folded }) => folded === 1);
    await hosted.host.stop();
    const sleepingAfterStopping = clock.sleeping();
    await views.ran('reasoning/runs', 2);
    const afterStopping = await views.viewOf('runs');

    expect([kept.phase, kept.view, afterStopping?.folded]).toEqual(['live', 1, 1]);
    expect(sleepingAfterStopping).toBe(0);
    expect(hosted.troubles()).toEqual([]);
  });
});

describe('a host given the settings of a database and of its projector', () => {
  it('makes the tables of the folders of its projector when it opens its store', async () => {
    const settings = await onSQLite();
    const folder = tallyFolderOf(1);

    const hosted = await hostedOn(settings, {
      projector: { folders: [someFolder(folder)], playbooksAtOnce: 1, pagesPerWake: 1 },
    });
    await hosted.host.stop();
    const playbooks = await Effect.runPromise(folder.playbooksWithRows(await openedOn(settings)));

    expect(playbooks).toEqual([]);
  });
});
