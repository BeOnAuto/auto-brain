import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { folded, pageOf, viewOf } from '../pool-testing/fold-pages.ts';

interface Folding {
  readonly view: Json;
  readonly work: number;
  readonly stalledAt?: number;
}

const sizesTestTimeoutMs = 120_000;

const startedAt = Date.parse('2026-10-01T09:00:00.000Z');

const threeThousand: readonly JsonObject[] = Array.from({ length: 3000 }, (_, index) => ({
  type: 'run_succeeded',
  subject: 'reasoning/review-brief',
  source: '/runs/run',
  time: new Date(startedAt + index * 1000).toISOString(),
  data: { output: { n: index } },
}));

const working = [
  'export function fold(view, event) {',
  '  const { n } = event.data.output;',
  '  let spent = 0;',
  '  for (let step = 0; step < 20000 + n * 7; step++) spent += step % 3;',
  '  return { folds: view.folds + 1, spent: (view.spent + spent) % 1000003 };',
  '}',
].join('\n');

const swelling = [
  'export function fold(view, event) {',
  '  const { n } = event.data.output;',
  '  return n === 1500 ? { folds: view.folds + 1, swell: "x".repeat(600000) } : { folds: view.folds + 1 };',
  '}',
].join('\n');

const before: Folding = { view: { folds: 0, spent: 0 }, work: 0 };

async function foldedInPages(fold: string, size: number, from: Folding = before, start = 0): Promise<Folding> {
  if (start >= threeThousand.length) {
    return from;
  }
  const events = threeThousand.slice(start, start + size);
  const page = await folded(
    pageOf([viewOf(fold, { view: from.view, events: events.map((_, index) => index) })], { events }),
  );
  const [result] = page.views;
  const work = from.work + (result?.work ?? 0);
  return result?.stall === undefined
    ? foldedInPages(fold, size, { view: result?.view ?? null, work }, start + size)
    : { view: result.view, work, stalledAt: start + result.stall.at };
}

describe('the folds of one view over 3,000 events', { timeout: sizesTestTimeoutMs }, () => {
  it('give the same view and spend the same checkpoints in pages of 7 as in pages of 1,000', async () => {
    const [seven, thousand] = [await foldedInPages(working, 7), await foldedInPages(working, 1000)];

    expect(thousand.work).toBeGreaterThan(3000);
    expect(seven).toEqual(thousand);
    expect(thousand.view).toMatchObject({ folds: 3000 });
  });

  it('stall at the event whose view outgrew its bound, at every size of page, though the next fold would shrink it back', async () => {
    const stalls = [
      await foldedInPages(swelling, 7),
      await foldedInPages(swelling, 1000),
      await foldedInPages(swelling, 3000),
    ].map(({ view, stalledAt }) => ({ view, stalledAt }));

    expect(stalls).toEqual([1, 2, 3].map(() => ({ view: { folds: 1500 }, stalledAt: 1500 })));
  });
});
