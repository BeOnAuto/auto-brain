import { Deferred, Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { background } from './background.ts';

interface Noting {
  readonly begun: () => readonly string[];
  readonly work: (name: string) => Effect.Effect<void>;
  readonly released: () => Promise<boolean>;
}

function noting(): Noting {
  const begun: string[] = [];
  const held = Deferred.makeUnsafe<void>();
  return {
    begun: () => begun,
    work: (name) =>
      Effect.sync(() => {
        begun.push(name);
      }).pipe(Effect.andThen(Deferred.await(held))),
    released: () => Effect.runPromise(Deferred.done(held, Exit.void)),
  };
}

describe('the work a host does in the background', () => {
  it('begins no second work for a key whose work still runs, and the next once the first is done', async () => {
    const running = background();
    const noted = noting();

    running.run('call', noted.work('first'));
    running.run('call', noted.work('second'));
    await noted.released();
    await Effect.runPromise(running.idle());
    running.run('call', noted.work('third'));
    await Effect.runPromise(running.idle());

    expect(noted.begun()).toEqual(['first', 'third']);
  });

  it('counts the work that runs, and awaits the work of the keys it is given that still runs', async () => {
    const running = background();
    const noted = noting();
    running.run('quick', Effect.void);
    await Effect.runPromise(running.awaited(['quick']));
    running.run('held', noted.work('held'));

    const sizes = [running.size()];
    const awaiting = Effect.runPromise(running.awaited(['quick', 'held', 'never run']));
    await noted.released();
    await awaiting;

    expect([...sizes, running.size()]).toEqual([1, 0]);
  });

  it('begins nothing once it stopped', async () => {
    const running = background();
    const noted = noting();
    await Effect.runPromise(running.stop());

    running.run('call', noted.work('after the stop'));
    await Effect.runPromise(running.idle());

    expect([noted.begun(), running.has('call')]).toEqual([[], false]);
  });
});
