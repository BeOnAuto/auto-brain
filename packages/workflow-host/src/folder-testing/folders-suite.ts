import { setTimeout } from 'node:timers/promises';

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { reconciledRows } from '../projector/folder-pass.ts';
import { definitionsByType } from '../projector/projector-schedule.ts';
import type { SettingsOf } from '../testing/host-files.ts';
import { alphaKey, counting, foldedAll, liveWith, viewTestTimeoutMs } from '../views-testing/view-documents.ts';
import { tallyFolder, type TallyDetails, type TallyRow } from './tally-folder.ts';
import { tallyHarness, type TallyHarness } from './tally-harness.ts';

const succeeded: TallyDetails = { counts: 'run_succeeded' };

const started: TallyDetails = { counts: 'run_started' };

const poisoned: TallyDetails = { counts: 'run_succeeded', stallsOn: 'poison' };

function liveCounting(counted: number): (row: TallyRow) => boolean {
  return (row) => row.phase === 'live' && row.counted === counted;
}

function phasesOf(rows: readonly TallyRow[]): Readonly<Record<string, string>> {
  return Object.fromEntries(rows.map(({ counts, phase }) => [counts, phase]));
}

async function readsWhile(tallies: TallyHarness, work: () => Promise<unknown>): Promise<number> {
  await setTimeout(100);
  const before = tallies.reads();
  await work();
  await setTimeout(100);
  return tallies.reads() - before;
}

function sharingTests(settingsOf: SettingsOf): void {
  it('folds in the host’s own process into a table of its own, beside the views of recall functions, and shares their one read a wake once both are caught up', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.saved('runs', counting);
    await tallies.savedTally('succeeded', succeeded);
    await tallies.ranEach('reasoning/runs', [1, 2]);
    tallies.startWithTallies({ sweepEveryMs: 60_000 });
    await tallies.until('runs', liveWith(2));
    await tallies.untilTally(succeeded, liveCounting(2));

    const shared = await readsWhile(tallies, async () => {
      await tallies.ran('reasoning/runs', 3);
      await tallies.until('runs', foldedAll(3));
      await tallies.untilTally(succeeded, liveCounting(3));
    });

    expect(shared).toBe(1);
  });
}

function phaseTests(settingsOf: SettingsOf): void {
  it('waits for a slot, rebuilds in it, goes live, and stalls at the event it cannot fold, folding nothing after it', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.savedTally('succeeded', succeeded);
    await tallies.savedTally('started', started);
    await tallies.savedTally('unreadable', { nothing: 'to count' });
    const kept = { database: tallies.store.database, rebuildsAtOnce: 1, definitions: definitionsByType().of };
    const slotted = await Effect.runPromise(reconciledRows(tallyFolder, kept, alphaKey));
    await tallies.ran('reasoning/runs', 'fine');
    tallies.startWithTallies({ rebuildsAtOnce: 1 });
    await tallies.untilTally(succeeded, liveCounting(1));
    await tallies.untilTally(started, liveCounting(1));

    await tallies.savedTally('poisoned', poisoned);
    await tallies.untilTally(poisoned, liveCounting(1));
    await tallies.ranEach('reasoning/runs', ['poison', 'after']);
    const stalled = await tallies.untilTally(poisoned, ({ phase }) => phase === 'stalled');
    await tallies.untilTally(succeeded, liveCounting(3));

    expect(phasesOf(slotted)).toEqual({ run_succeeded: 'rebuilding', run_started: 'waiting' });
    expect(stalled.counted).toBe(1);
  });
}

function restartTests(settingsOf: SettingsOf): void {
  it('keeps its checkpoint over a restart, so a new projector folds only what came after it, each event once', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.savedTally('succeeded', succeeded);
    await tallies.ranEach('reasoning/runs', [1, 2]);
    const first = tallies.startWithTallies();
    const before = await tallies.untilTally(succeeded, liveCounting(2));
    await first.stop();

    await tallies.ranEach('reasoning/runs', [3, 4, 5]);
    tallies.startWithTallies();
    await tallies.untilTally(succeeded, liveCounting(5));
    await setTimeout(300);
    const [after] = await tallies.tallies();

    expect(before.checkpoint).toBeDefined();
    expect([after?.phase, after?.counted]).toEqual(['live', 5]);
  });
}

function definitionTests(settingsOf: SettingsOf): void {
  it('rebuilds from the start when its definition changes, keeps one row for the definitions that name it, and drops it when none does', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.savedTally('one', succeeded);
    await tallies.savedTally('another', succeeded);
    await tallies.ranEach('reasoning/runs', [1, 2]);
    tallies.startWithTallies();
    await tallies.untilTally(succeeded, liveCounting(2));
    const shared = await tallies.tallies();

    await tallies.savedTally('one', poisoned);
    const rebuilt = await tallies.untilTally(poisoned, liveCounting(2));
    const both = await tallies.tallies();
    await tallies.retiredTally('another');
    await tallies.goneTally(succeeded);

    expect([shared.length, both.length, rebuilt.counted]).toEqual([1, 2, 2]);
  });
}

function rowTests(settingsOf: SettingsOf): void {
  it('takes no write from a pass that read its row before another wrote it', async () => {
    const tallies = await tallyHarness(await settingsOf());
    await tallies.savedTally('succeeded', succeeded);
    const kept = { database: tallies.store.database, rebuildsAtOnce: 1, definitions: definitionsByType().of };
    const rows = await Effect.runPromise(reconciledRows(tallyFolder, kept, alphaKey));
    const writing = { database: tallies.store.database, brain: alphaKey, note: tallies.reports.reports.note };

    const stale = rows.map((row) => tallyFolder.unchanged({ ...row, checkpointText: 'not its checkpoint' }));
    const written = await Promise.all(stale.map((change) => Effect.runPromise(tallyFolder.write(writing, change))));

    expect([written, stale.map((change) => tallyFolder.hasChanged(change))]).toEqual([[undefined], [false]]);
  });
}

export function foldersSuite(settingsOf: SettingsOf): void {
  describe('a second folder beside the views of recall functions', { timeout: viewTestTimeoutMs }, () => {
    sharingTests(settingsOf);
    phaseTests(settingsOf);
    restartTests(settingsOf);
    definitionTests(settingsOf);
    rowTests(settingsOf);
  });
}
