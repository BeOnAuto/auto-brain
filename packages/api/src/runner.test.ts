import { Data, Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeRunner } from './index.ts';

class LayerFailed extends Data.TaggedError('LayerFailed')<{ readonly message: string }> {}

describe('makeRunner', () => {
  it('resolves an effect to its value', async () => {
    const runner = await makeRunner(Layer.empty);

    expect(await runner.run(Effect.succeed(42))).toBe(42);
  });

  it('reports an effect that interrupts itself as stopped', async () => {
    const runner = await makeRunner(Layer.empty);

    expect(await runner.run(Effect.interrupt)).toEqual({ status: 'stopped' });
  });

  it('stops an effect in flight when disposed, and refuses new ones', async () => {
    const runner = await makeRunner(Layer.empty);
    const inFlight = runner.run(Effect.never);
    await runner.dispose();

    expect(await inFlight).toEqual({ status: 'stopped' });
    expect(await runner.run(Effect.succeed(1))).toEqual({ status: 'stopped' });
  });

  it('rejects with the cause of a defect', async () => {
    const runner = await makeRunner(Layer.empty);

    await expect(runner.run(Effect.die(new Error('boom')))).rejects.toThrow('boom');
  });

  it('fails to start when a layer fails to build', async () => {
    await expect(
      makeRunner(Layer.effectDiscard(Effect.fail(new LayerFailed({ message: 'no ledger' })))),
    ).rejects.toThrow('no ledger');
  });
});
