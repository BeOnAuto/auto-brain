import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { settle } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { giveUp, linger } from '../testing/misbehaving.ts';

const toAlpha = toBrain('acme', 'alpha');

describe('settling a call', () => {
  it('gives the outcome of a call that finishes', async () => {
    const { dispatcher, run, settleWithin } = harness();
    const quick = dispatcher.inBrain(linger.registration, toAlpha(acmeAdmin, { milliseconds: 0 }));

    expect(await settleWithin(10_000, quick)).toEqual({ status: 'done', output: { lingered: 0 } });
    expect(await run(settle(quick))).toEqual({ status: 'done', output: { lingered: 0 } });
  });

  it('gives stopped when the signal aborts the call, and reports nothing', async () => {
    const { dispatcher, reported, settleWithin } = harness();
    const slow = dispatcher.inBrain(linger.registration, toAlpha(acmeAdmin, { milliseconds: 60_000 }));

    expect({ settled: await settleWithin(20, slow), reported: reported() }).toEqual({
      settled: { status: 'stopped' },
      reported: [],
    });
  });

  it('gives stopped at once when the signal has already aborted', async () => {
    const { dispatcher, run } = harness();
    const slow = dispatcher.inBrain(linger.registration, toAlpha(acmeAdmin, { milliseconds: 60_000 }));

    expect(await run(settle(slow, AbortSignal.abort()))).toEqual({ status: 'stopped' });
  });

  it('gives stopped for a call that interrupts itself, which is no fault', async () => {
    const { dispatcher, reported, run } = harness();

    expect({
      settled: await run(settle(dispatcher.inBrain(giveUp.registration, toAlpha(acmeAdmin)))),
      reported: reported(),
    }).toEqual({ settled: { status: 'stopped' }, reported: [] });
  });

  it('gives faulted with a reported incident for any other failure', async () => {
    const { reported, run } = harness();

    const settled = await run(settle(Effect.die(new Error('escaped the call'))));

    expect(settled).toEqual({ status: 'faulted', incident: reported()[0]?.id });
    expect(reported()).toEqual([{ id: reported()[0]?.id, original: new Error('escaped the call') }]);
  });
});
