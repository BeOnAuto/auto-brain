import { Clock, Effect } from 'effect';

import type { ListedModel } from '../listing/listed-model.ts';

const freshForMs = 300_000;

interface Listing {
  readonly models: readonly ListedModel[];
  readonly listedAt: number;
}

export interface CachedListing {
  readonly listing: Listing | null;
  readonly current: boolean;
}

export interface ListingCache {
  readonly read: (key: string, refresh: Effect.Effect<readonly ListedModel[] | null>) => Effect.Effect<CachedListing>;
}

export function listingCache(): ListingCache {
  const listings = new Map<string, Listing>();
  const refreshing = new Map<string, Promise<Listing | null>>();

  const kept = (key: string, refresh: Effect.Effect<readonly ListedModel[] | null>): Effect.Effect<Listing | null> =>
    Effect.flatMap(refresh, (models) =>
      models === null
        ? Effect.succeed(null)
        : Effect.map(Clock.currentTimeMillis, (listedAt) => {
            const listing: Listing = { models, listedAt };
            listings.set(key, listing);
            return listing;
          }),
    );

  const started = (key: string, refreshed: Promise<Listing | null>): Promise<Listing | null> => {
    const forget = (): void => {
      refreshing.delete(key);
    };
    refreshing.set(key, refreshed);
    void refreshed.then(forget, forget);
    return refreshed;
  };

  return {
    read: (key, refresh) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const cached = listings.get(key);
        if (cached !== undefined && now - cached.listedAt < freshForMs) {
          return { listing: cached, current: true };
        }
        const context = yield* Effect.context();
        const refreshed = yield* Effect.sync(
          () => refreshing.get(key) ?? started(key, Effect.runPromiseWith(context)(kept(key, refresh))),
        );
        const listing = yield* Effect.promise(() => refreshed);
        return listing === null ? { listing: listings.get(key) ?? null, current: false } : { listing, current: true };
      }),
  };
}
