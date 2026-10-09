import { describe, expect, it } from 'vitest';

import { expressionUnitOf } from '../programs/expression-units.ts';
import { threadStackBytes } from '../programs/sandbox-bounds.ts';
import { cachedStripping } from '../programs/type-stripping.ts';
import { freshInstance, pageBytes } from './fresh-instances.ts';
import { instanceStock } from './instance-stock.ts';

const evaluation = { budget: 1_000_000, deadlineAt: Number.POSITIVE_INFINITY, moment: 0 };

function allocated(memoryBytes: number, megabytes: number): Promise<unknown> {
  return freshInstance(memoryBytes).then((instance) => {
    const unit = expressionUnitOf(
      () => instance,
      { stackBytes: threadStackBytes, mostAnswerBytes: 1024, clock: () => 0 },
      cachedStripping(),
    );
    const run = unit.evaluate(
      `(() => { const kept: string[] = []; for (let index = 0; index < ${megabytes}; index++) kept.push("y".repeat(1048576) + index); return kept.length })()`,
      {},
      evaluation,
    );
    unit.close();
    return { run, refused: instance.refusedGrowth() };
  });
}

describe('a fresh instance', () => {
  it('grows its memory up to the maximum it was made with, and refuses to grow past it', async () => {
    expect(await allocated(64 * pageBytes * 16, 40)).toMatchObject({
      run: { ran: 'answered', text: '40' },
      refused: false,
    });
    expect(await allocated(64 * pageBytes * 16, 80)).toMatchObject({
      run: { ran: 'exhausted', limit: 'memory' },
      refused: true,
    });
  });

  it('shares nothing with another instance made from the same compiled module', async () => {
    const [first, second] = await Promise.all([freshInstance(pageBytes * 512), freshInstance(pageBytes * 512)]);

    expect(first.module).not.toBe(second.module);
    expect([first.memoryBytes, second.memoryBytes]).toEqual([pageBytes * 512, pageBytes * 512]);
  });
});

describe('a stock of instances', () => {
  it('hands out a fresh instance of the memory asked for every time, preparing the next while the last is in use', async () => {
    const instances = instanceStock();

    const [first, second, other] = [
      await instances(pageBytes * 512),
      await instances(pageBytes * 512),
      await instances(pageBytes * 1024),
    ];

    expect(first.module).not.toBe(second.module);
    expect([first.memoryBytes, second.memoryBytes, other.memoryBytes]).toEqual([
      pageBytes * 512,
      pageBytes * 512,
      pageBytes * 1024,
    ]);
  });
});
