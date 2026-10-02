import { setTimeout } from 'node:timers/promises';

import { Effect, Fiber, Logger, Schema } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { retryDelayMs, runSupervised, superviseWorker, workerBackoff, type StartWorker } from './worker-supervisor.ts';

const decodeLine = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      message: Schema.String,
      level: Schema.String,
      annotations: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Number])),
    }),
  ),
);

interface Logged {
  readonly message: string;
  readonly level: string;
  readonly error: string | number | undefined;
  readonly retryMs: number;
}

interface FakeWorkers {
  readonly start: StartWorker;
  readonly events: () => readonly string[];
  readonly stopOnItsOwn: (detail: string) => void;
}

type Outcome = 'down' | 'broken' | 'up';

function fakeWorkers(outcomes: readonly Outcome[]): FakeWorkers {
  const events: string[] = [];
  const running: ((detail: string) => void)[] = [];
  const start: StartWorker = (onFailure) =>
    Effect.suspend(() => {
      const outcome = outcomes[events.filter((event) => event.startsWith('start')).length] ?? 'up';
      events.push(`start ${outcome}`);
      if (outcome === 'down') {
        return Effect.fail({ detail: 'Temporal cannot be reached' });
      }
      if (outcome === 'broken') {
        return Effect.die('a broken worker');
      }
      running.push(onFailure);
      return Effect.addFinalizer(() =>
        Effect.sync(() => {
          events.push('stopped');
        }),
      );
    });
  return {
    start,
    events: () => events,
    stopOnItsOwn: (detail) => {
      running.at(-1)?.(detail);
    },
  };
}

async function supervised(workers: FakeWorkers, steps: Effect.Effect<void>): Promise<readonly Logged[]> {
  const lines: Logged[] = [];
  const capture = Logger.map(Logger.formatJson, (line: string) => {
    const { message, level, annotations } = decodeLine(line);
    lines.push({ message, level, error: annotations['error'], retryMs: Number(annotations['retry_ms'] ?? 0) });
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(superviseWorker(workers.start));
      yield* steps;
      yield* Fiber.interrupt(fiber);
    }).pipe(Effect.provide(TestClock.layer()), Effect.provide(Logger.layer([capture]))),
  );
  return lines;
}

function withoutDelays(lines: readonly Logged[]): readonly (readonly [string, string, unknown])[] {
  return lines.map(({ message, level, error }) => [level, message.replace(/[\d.]+ s$/u, 'N s'), error]);
}

const settle = Effect.yieldNow;

describe('the workflow worker the server supervises', () => {
  it('is started again with growing, jittered delays while Temporal cannot be reached, warning each time', async () => {
    const workers = fakeWorkers(['down', 'down', 'up']);

    const lines = await supervised(
      workers,
      Effect.gen(function* () {
        yield* settle;
        yield* TestClock.adjust(1000);
        yield* TestClock.adjust(2000);
      }),
    );

    expect(workers.events()).toEqual(['start down', 'start down', 'start up', 'stopped']);
    expect(withoutDelays(lines)).toEqual([
      ['WARN', 'The workflow worker could not start; it tries again in N s', 'Temporal cannot be reached'],
      ['WARN', 'The workflow worker could not start; it tries again in N s', 'Temporal cannot be reached'],
      ['INFO', 'The workflow worker started', undefined],
    ]);
    expect(lines[0]?.retryMs).toBeGreaterThanOrEqual(500);
    expect(lines[0]?.retryMs).toBeLessThanOrEqual(1000);
    expect(lines[1]?.retryMs).toBeGreaterThanOrEqual(1000);
    expect(lines[1]?.retryMs).toBeLessThanOrEqual(2000);
  });

  it('logs a worker that stops on its own as an error once, and starts it again with the same backoff', async () => {
    const workers = fakeWorkers(['up', 'up']);

    const lines = await supervised(
      workers,
      Effect.gen(function* () {
        yield* settle;
        workers.stopOnItsOwn('The orchestration worker stopped: the core panicked');
        yield* settle;
        yield* TestClock.adjust(1000);
      }),
    );

    expect(workers.events()).toEqual(['start up', 'stopped', 'start up', 'stopped']);
    expect(withoutDelays(lines.filter(({ level }) => level === 'ERROR'))).toEqual([
      [
        'ERROR',
        'The workflow worker stopped on its own; it starts again in N s',
        'The orchestration worker stopped: the core panicked',
      ],
    ]);
  });
});

describe('the failures the supervisor counts', () => {
  it('reports a worker that breaks while starting by what broke it', async () => {
    const workers = fakeWorkers(['broken']);

    const lines = await supervised(workers, settle);

    expect(withoutDelays(lines)).toEqual([
      ['WARN', 'The workflow worker could not start; it tries again in N s', 'a broken worker'],
    ]);
  });

  it('start afresh once a worker has run for a minute', async () => {
    const workers = fakeWorkers(['down', 'down', 'down', 'up', 'up']);

    const lines = await supervised(
      workers,
      Effect.gen(function* () {
        yield* settle;
        yield* TestClock.adjust(8000);
        yield* TestClock.adjust(60_000);
        workers.stopOnItsOwn('The orchestration worker stopped on its own');
        yield* settle;
      }),
    );
    const stopped = lines.at(-1);

    expect(stopped?.level).toBe('ERROR');
    expect(stopped?.retryMs).toBeLessThanOrEqual(workerBackoff.firstMs);
  });
});

describe('stopping a supervised worker that does not stop', () => {
  it('gives up after 11 seconds, a second more than the worker gives activities to finish', async () => {
    const worker = runSupervised(Effect.never.pipe(Effect.onInterrupt(() => Effect.never)));
    const stopping = performance.now();

    const outcome = await Promise.race([
      worker.stop().then(() => 'gave up'),
      setTimeout(20_000, 'still stopping', { ref: false }),
    ]);
    const tookMs = performance.now() - stopping;

    expect(outcome).toBe('gave up');
    expect(tookMs).toBeGreaterThanOrEqual(10_900);
    expect(tookMs).toBeLessThan(12_500);
  }, 30_000);
});

describe('the delay before the worker is started again', () => {
  it('doubles from a second up to 30 seconds, and lies between half of that and all of it', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12].map((failures) => retryDelayMs(failures, 1))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ]);
    expect([1, 6].map((failures) => retryDelayMs(failures, 0))).toEqual([500, 15_000]);
  });
});
