import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { settle } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { breakOnceLeft, giveUp, linger } from '../testing/misbehaving.ts';

const toAlpha = toBrain('acme', 'alpha');

describe('a settled call', () => {
  it('is the outcome of a call that finishes', async () => {
    const { dispatcher, run, settleWithin } = harness();
    const quick = dispatcher.dispatchToBrain(linger.registration, toAlpha(acmeAdmin, { milliseconds: 0 }));

    expect(await settleWithin(10_000, quick)).toEqual({ status: 'succeeded', output: { lingered: 0 } });
    expect(await run(settle(quick))).toEqual({ status: 'succeeded', output: { lingered: 0 } });
  });

  it('is cancelled when the signal aborts the call, and nothing is reported', async () => {
    const { dispatcher, reported, settleWithin } = harness();
    const slow = dispatcher.dispatchToBrain(linger.registration, toAlpha(acmeAdmin, { milliseconds: 60_000 }));

    expect({ settled: await settleWithin(20, slow), reported: reported() }).toEqual({
      settled: { status: 'cancelled' },
      reported: [],
    });
  });

  it('is cancelled at once when the signal has already aborted', async () => {
    const { dispatcher, run } = harness();
    const slow = dispatcher.dispatchToBrain(linger.registration, toAlpha(acmeAdmin, { milliseconds: 60_000 }));

    expect(await run(settle(slow, AbortSignal.abort()))).toEqual({ status: 'cancelled' });
  });

  it('is cancelled when the call interrupts itself, which is not a failure', async () => {
    const { dispatcher, reported, run } = harness();

    expect({
      settled: await run(settle(dispatcher.dispatchToBrain(giveUp.registration, toAlpha(acmeAdmin)))),
      reported: reported(),
    }).toEqual({ settled: { status: 'cancelled' }, reported: [] });
  });

  it('fails with a reported incident for any other failure', async () => {
    const { reported, run } = harness();

    const settled = await run(settle(Effect.die(new Error('escaped the call'))));

    expect(settled).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(reported()).toEqual([{ id: reported()[0]?.id, original: new Error('escaped the call') }]);
  });
});

describe('a call whose signal aborts it', () => {
  it('is cancelled, and a defect the call raises after that is still reported as an incident', async () => {
    const { dispatcher, reported, settleWithin } = harness();
    const breaking = dispatcher.dispatchToBrain(breakOnceLeft.registration, toAlpha(acmeAdmin));

    expect(await settleWithin(20, breaking)).toEqual({ status: 'cancelled' });
    expect(reported()).toEqual([
      {
        id: reported()[0]?.id,
        original: new Error('broken after its caller left'),
        call: { operation: 'break_once_left', org: 'acme', brain: 'alpha', caller: 'acme-admin' },
      },
    ]);
  });
});
