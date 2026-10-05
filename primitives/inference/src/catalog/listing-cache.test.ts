import { setTimeout as delay } from 'node:timers/promises';

import { Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { describe, expect, it } from 'vitest';

import { catalogFor, idsIn, type CatalogHarness } from '../testing/catalog-harness.ts';
import { anthropicModels } from '../testing/model-lists.ts';
import { jsonResponse, type Responder } from '../testing/recording-fetch.ts';
import { listingCache } from './listing-cache.ts';
import type { ModelList } from './model-list.ts';

const startedAt = Date.parse('2026-10-01T09:00:00.000Z');

const anthropic = { ANTHROPIC_API_KEY: 'sk-ant-key' };

function listOf(catalog: CatalogHarness): Effect.Effect<ModelList> {
  return catalog.access.catalog.list();
}

function onTestClock<A>(scenario: Effect.Effect<A>): Promise<A> {
  return Effect.runPromise(
    TestClock.setTime(startedAt).pipe(Effect.andThen(scenario), Effect.provide(TestClock.layer())),
  );
}

function failingFrom(attempt: number): Responder {
  return (_request, made) =>
    made >= attempt ? jsonResponse({ error: 'overloaded' }, 529) : jsonResponse(anthropicModels);
}

const failingFirst: Responder = (_request, made) =>
  made === 1 ? jsonResponse({}, 503) : jsonResponse(anthropicModels);

describe('the list of a provider', () => {
  it('is read once and kept for five minutes, then read again', async () => {
    const catalog = await catalogFor(anthropic, () => jsonResponse(anthropicModels));

    const reads = await onTestClock(
      Effect.gen(function* () {
        yield* listOf(catalog);
        yield* TestClock.adjust('299 seconds');
        const kept = yield* listOf(catalog);
        const readsWhileKept = catalog.requests().length;
        yield* TestClock.adjust('1 second');
        const renewed = yield* listOf(catalog);
        return { readsWhileKept, kept: kept.listed_at, renewed: renewed.listed_at };
      }),
    );

    expect(reads).toEqual({
      readsWhileKept: 1,
      kept: '2026-10-01T09:00:00.000Z',
      renewed: '2026-10-01T09:05:00.000Z',
    });
    expect(catalog.requests()).toHaveLength(2);
  });

  it('is read once for calls that arrive while it is being read', async () => {
    const catalog = await catalogFor(anthropic, async () => {
      await delay(20);
      return jsonResponse(anthropicModels);
    });

    const lists = await Effect.runPromise(
      Effect.all([listOf(catalog), listOf(catalog), listOf(catalog)], { concurrency: 'unbounded' }),
    );

    expect(catalog.requests()).toHaveLength(1);
    expect(lists.map((list) => idsIn(list).length)).toEqual([3, 3, 3]);
  });
});

describe('a list of a provider that cannot be read again', () => {
  it('is served as it was last read, marked partial, while it cannot be read again, and is asked for every time', async () => {
    const catalog = await catalogFor(anthropic, failingFrom(2));

    const lists = await onTestClock(
      Effect.gen(function* () {
        yield* listOf(catalog);
        yield* TestClock.adjust('6 minutes');
        const stale = yield* listOf(catalog);
        const again = yield* listOf(catalog);
        return [stale, again];
      }),
    );

    expect(
      lists.map(({ catalog_status: status, listed_at: listedAt, data }) => [status, listedAt, data.length]),
    ).toEqual([
      ['partial', '2026-10-01T09:00:00.000Z', 3],
      ['partial', '2026-10-01T09:00:00.000Z', 3],
    ]);
    expect(catalog.requests()).toHaveLength(3);
    expect(catalog.reports().map(({ status }) => status)).toEqual([529, 529]);
  });

  it('is complete again once it can be read', async () => {
    const catalog = await catalogFor(anthropic, failingFirst);

    const failed = await Effect.runPromise(listOf(catalog));
    const recovered = await Effect.runPromise(listOf(catalog));

    expect([failed.catalog_status, failed.data.length]).toEqual(['partial', 0]);
    expect([recovered.catalog_status, recovered.data.length]).toEqual(['complete', 3]);
  });
});

describe('the lists of providers kept together', () => {
  it('are kept apart by credential, so one credential never sees the list read with another', async () => {
    const cache = listingCache();
    const acme = await catalogFor({ ANTHROPIC_API_KEY: 'sk-ant-acme' }, () => jsonResponse(anthropicModels), {
      listingCache: cache,
    });
    const globex = await catalogFor(
      { ANTHROPIC_API_KEY: 'sk-ant-globex' },
      () => jsonResponse({ data: [{ id: 'claude-globex-tuned' }] }),
      { listingCache: cache },
    );
    const acmeAgain = await catalogFor({ ANTHROPIC_API_KEY: 'sk-ant-acme' }, () => jsonResponse({ data: [] }), {
      listingCache: cache,
    });

    expect(idsIn(await acme.list())).toHaveLength(3);
    expect(idsIn(await globex.list())).toEqual(['anthropic/claude-globex-tuned']);
    expect(idsIn(await acmeAgain.list())).toHaveLength(3);
    expect([acme, globex, acmeAgain].map((catalog) => catalog.requests().length)).toEqual([1, 1, 0]);
  });
});
