import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { Effect, Fiber, Logger, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { superviseWorker, type StartWorker } from './worker-supervisor.ts';

setFlagsFromString('--expose-gc');

const collectGarbage = Schema.decodeUnknownSync(
  Schema.declare((value: unknown): value is () => void => typeof value === 'function'),
)(runInNewContext('gc'));

const restarts = 20_000;

const neverStarts: StartWorker = () => Effect.fail({ detail: 'Temporal cannot be reached' });

function heapUsedMiB(): number {
  collectGarbage();
  return process.memoryUsage().heapUsed / 1_048_576;
}

describe('a worker the supervisor starts again and again', () => {
  it('costs the supervisor no memory for each time it was started', async () => {
    const growthMiB = await Effect.runPromise(
      Effect.gen(function* () {
        const supervisor = yield* Effect.forkChild(
          superviseWorker(neverStarts, { firstMs: 1, mostMs: 1, steadyAfterMs: 60_000 }),
        );
        yield* TestClock.adjust(10);
        const before = heapUsedMiB();
        yield* Effect.repeat(TestClock.adjust(1), { times: restarts });
        const after = heapUsedMiB();
        yield* Fiber.interrupt(supervisor);
        return after - before;
      }).pipe(Effect.provide(TestClock.layer()), Effect.provide(Logger.layer([]))),
    );

    expect(growthMiB).toBeLessThan(6);
  }, 60_000);
});
