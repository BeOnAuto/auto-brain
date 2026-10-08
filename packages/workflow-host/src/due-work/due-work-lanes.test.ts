import { describe, expect, it } from 'vitest';

import { eventually } from '../testing/eventually.ts';
import { dueLooping, keysOf } from './due-looping.ts';
import { dueAwaitedMs, dueInOneTick, duePerformedAtOnce } from './due-work.ts';
import { fakeDueWork } from './fake-due-work.ts';

describe('a due row that calls out nowhere, behind more deliveries than one read of them takes', () => {
  it('is performed at once, read apart from the deliveries due before it', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    for (const key of keysOf(2 * dueInOneTick + 300, 'delivery')) {
      rows.add(key, now - 2000);
      rows.hanging(key);
    }
    rows.add('expiry', now - 1000);
    rows.local('expiry');

    await dueLooping(rows);
    const [performed] = await eventually(rows.performed, (done) => done.length > 0);

    expect(performed?.key).toBe('expiry');
    expect(Date.now() - now).toBeLessThan(dueAwaitedMs);
  });
});

describe('a delivery that waits for a place while deliveries hang', () => {
  it('is not held, so it ends at once when its ending comes due', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    for (const key of keysOf(duePerformedAtOnce + 4, 'delivery')) {
      rows.add(key, now - 1000);
    }
    for (const key of keysOf(duePerformedAtOnce, 'delivery')) {
      rows.hanging(key);
    }
    const endsAt = now + dueAwaitedMs + 500;
    rows.endsAt('delivery-19', endsAt);

    await dueLooping(rows);
    const [performed] = await eventually(rows.performed, (done) => done.length > 0);

    expect(performed?.key).toBe('delivery-19');
    expect(Date.now() - endsAt).toBeLessThan(dueAwaitedMs);
    expect(rows.attempts().filter(({ key }) => key !== 'delivery-19')).toHaveLength(duePerformedAtOnce);
  });
});

describe('a due row whose ending falls due while a tick waits for the rows it handed out', () => {
  it('is performed by the next tick, not at the next sweep', async () => {
    const now = Date.now();
    const rows = fakeDueWork();
    for (const key of keysOf(duePerformedAtOnce + 4, 'delivery')) {
      rows.add(key, now - 1000);
    }
    for (const key of keysOf(duePerformedAtOnce, 'delivery')) {
      rows.hanging(key);
    }
    const endsAt = now + 300;
    rows.endsAt('delivery-19', endsAt);

    await dueLooping(rows);
    const [performed] = await eventually(rows.performed, (done) => done.length > 0);

    expect(performed?.key).toBe('delivery-19');
    expect(Date.now() - endsAt).toBeLessThan(2 * dueAwaitedMs);
  });
});

describe('due rows that end while the loop reads when to wake next', () => {
  it('wake it, so the rows behind them are handed out then and not at the next sweep', async () => {
    const now = Date.now();
    const rows = fakeDueWork(dueAwaitedMs + 500, { nextReadMs: 1000 });
    for (const key of keysOf(duePerformedAtOnce + 1, 'delivery')) {
      rows.add(key, now - 1000);
    }

    await dueLooping(rows);
    const performed = await eventually(rows.performed, (done) => done.length === duePerformedAtOnce + 1, 800);

    expect(performed).toHaveLength(duePerformedAtOnce + 1);
  }, 15_000);
});

describe('a host that stops while due rows are in flight', () => {
  it('interrupts them in both lanes', async () => {
    const rows = fakeDueWork();
    for (const key of ['delivery', 'expiry']) {
      rows.add(key, Date.now() - 1000);
      rows.hanging(key);
    }
    rows.local('expiry');
    const looping = await dueLooping(rows);
    await eventually(rows.attempts, (made) => made.length === 2);

    await looping.stop();

    expect(new Set(rows.interrupted())).toEqual(new Set(['delivery', 'expiry']));
  });
});
