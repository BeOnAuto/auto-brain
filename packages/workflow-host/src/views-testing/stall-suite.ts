import { describe, expect, it } from 'vitest';

import type { SettingsOf } from '../testing/host-files.ts';
import {
  counting,
  detailsOf,
  foldedAll,
  foldingOf,
  isStalled,
  succeeded,
  viewTestTimeoutMs,
} from './view-documents.ts';
import { viewHarness, type ViewHarness } from './view-harness.ts';

const raisingWithTheEvent =
  'if $event.data.output == "bad" then error("cannot take \\($event.data.output)") else . + 1 end';

const anyText: unknown = expect.any(String);

const stallingFolds: readonly (readonly [string, string, Readonly<Record<string, unknown>>])[] = [
  ['raises with the event', raisingWithTheEvent, { kind: 'raised', message: 'cannot take bad', line: 30 }],
  [
    'reads event text as a number',
    'if $event.data.output == "bad" then . + ($event.data.output | tonumber) else . + 1 end',
    { kind: 'raised', line: 30 },
  ],
  ['gives no output', 'if $event.data.output == "bad" then empty else . + 1 end', { kind: 'none', line: null }],
  ['gives two outputs', 'if $event.data.output == "bad" then (., .) else . + 1 end', { kind: 'several', line: null }],
  [
    'does too much work',
    'if $event.data.output == "bad" then ("x" * 20000000 | length) else . + 1 end',
    { kind: 'work', line: 30 },
  ],
  [
    'nests too deep',
    'if $event.data.output == "bad" then reduce range(600) as $i (.; [.]) else . + 1 end',
    { kind: 'depth', line: 30 },
  ],
  [
    'outgrows its bound',
    'if $event.data.output == "bad" then "x" * 600000 else . + 1 end',
    { kind: 'size', line: null },
  ],
];

async function threeRuns(views: ViewHarness): Promise<void> {
  await views.ranEach('inference/runs', ['good', 'bad', 'later']);
}

function stoppingTests(settingsOf: SettingsOf): void {
  it.each(stallingFolds)(
    'stops at the event when its fold %s, keeping what it folded before and naming the event',
    async (_way, fold, stall) => {
      const views = await viewHarness(await settingsOf());
      await views.saved('runs', detailsOf(fold, succeeded, { initial: 0 }));
      await threeRuns(views);
      views.start();

      const kept = await views.until('runs', isStalled);

      expect(kept).toMatchObject({ view: 1, folded: 1, stall: { ...stall, event: { type: 'execution_succeeded' } } });
      expect(kept.stall?.event.id).toEqual(anyText);
      expect(kept.stall?.event.time).toBe('2026-10-06T10:00:00.000Z');
    },
  );

  it('stops when the view it folds is one its schema refuses', async () => {
    const views = await viewHarness(await settingsOf());
    const schema = { type: 'array', maxItems: 1 };
    await views.saved('runs', detailsOf('. + [$event.data.output]', succeeded, { initial: [], schema }));
    await threeRuns(views);
    views.start();

    const kept = await views.until('runs', isStalled);

    expect(kept).toMatchObject({ view: ['good'], folded: 1, stall: { kind: 'schema', line: null } });
    expect(kept.stall?.message).toMatch(/^Expected a value with a length of at most 1/u);
  });
}

function afterTheStallTests(settingsOf: SettingsOf): void {
  it('holds back no other view of the brain, nor what the brain records afterwards', async () => {
    const views = await viewHarness(await settingsOf());
    await views.saved('stalling', detailsOf(raisingWithTheEvent, succeeded, { initial: 0 }));
    await views.saved('counting', counting);
    await threeRuns(views);
    views.start();

    await views.until('stalling', isStalled);
    await views.ran('inference/runs', 'after the stall');
    const kept = await views.until('counting', foldedAll(4));
    const stalling = await views.viewOf('stalling');

    expect([kept.view, stalling?.folded, stalling?.phase]).toEqual([4, 1, 'stalled']);
  });

  it('is tried again when its fold runs past its deadline, counting the tries on its row, and stops after twenty', async () => {
    const views = await viewHarness(await settingsOf());
    const slow = 'if $event.data.output == "bad" then reduce range(3000000) as $i (.; . + 0) else . + 1 end';
    await views.saved('runs', detailsOf(slow, succeeded, { initial: 0 }));
    await threeRuns(views);
    views.start({ folding: { ...foldingOf(), foldDeadlineMs: 1 }, sweepEveryMs: 20 });

    const kept = await views.until('runs', isStalled);

    expect(kept).toMatchObject({ view: 1, folded: 1, stall: { kind: 'time', line: null } });
    expect(kept.stall?.message).toBe('The fold was stopped by its deadline of 1 ms 20 times');
  });
}

export function stallSuite(settingsOf: SettingsOf): void {
  describe('a view that stalls', { timeout: viewTestTimeoutMs }, () => {
    stoppingTests(settingsOf);
    afterTheStallTests(settingsOf);
  });
}
