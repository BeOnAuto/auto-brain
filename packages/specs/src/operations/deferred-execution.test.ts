import { describe, expect, it } from 'vitest';

import { firstMoment } from '../testing/harness.ts';
import { relayedId, withHandOn } from '../testing/relaying.ts';

const waiting = {
  status: 'succeeded',
  output: {
    execution_id: relayedId,
    primitive: 'relay',
    name: 'hand-on',
    spec_version: 1,
    status: 'started',
    started_at: firstMoment,
    started_by: 'acme-admin',
  },
};

describe('an execution whose primitive finishes it after the call returns', () => {
  it('is answered as started, and read as started until it is settled', async () => {
    const { executing, reading } = await withHandOn();

    expect(await executing()).toStrictEqual(waiting);
    expect(await reading()).toStrictEqual({
      status: 'succeeded',
      output: { ...waiting.output, record: { handed_on: relayedId } },
    });
  });

  it('is not started a second time by a call with its id while it waits to be settled', async () => {
    const { executing, relayer } = await withHandOn();
    await executing();

    expect(await executing()).toStrictEqual(waiting);
    expect(relayer.runs()).toBe(1);
  });

  it('is recorded as waiting when its call is cancelled while the primitive starts it, never left without a result', async () => {
    const { executingCancelledOnceStarted, reading, relayer } = await withHandOn();

    expect(await executingCancelledOnceStarted({ startingMs: 200 })).toStrictEqual({ status: 'cancelled' });
    expect(relayer.runs()).toBe(1);
    expect(await reading()).toStrictEqual({
      status: 'succeeded',
      output: { ...waiting.output, record: { handed_on: relayedId } },
    });
  });

  it('fails when what the primitive started takes more than an execution may record', async () => {
    const { executing, reading, reported } = await withHandOn();

    expect(await executing(1_048_576)).toEqual({ status: 'failed', incident: reported()[0]?.id });
    expect(await reading()).toMatchObject({ output: { status: 'failed' } });
  });
});
