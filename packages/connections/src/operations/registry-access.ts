import { Caller, OrgReader, OrgWriter, type NotFound } from '@on.auto/operations';
import { DateTime, Effect } from 'effect';

import type { ConnectionCommandData } from '../registry/connection-commands.ts';
import { connectionsStream, registryDecider } from '../registry/registry-decider.ts';
import { findConnection } from '../registry/registry-lookup.ts';
import type { KeptConnection, Registry } from '../registry/registry.ts';

export const loadRegistry: Effect.Effect<Registry, never, OrgReader> = Effect.gen(function* () {
  const { state } = yield* (yield* OrgReader).load(connectionsStream, registryDecider);
  return state;
});

export function foundConnection(id: string): Effect.Effect<KeptConnection, NotFound, OrgReader> {
  return loadRegistry.pipe(Effect.flatMap((registry) => findConnection(registry, id)));
}

export const actedNow = Effect.gen(function* () {
  const { id: by } = yield* Caller;
  return { by, at: DateTime.formatIso(yield* DateTime.now) };
});

export const recordInRegistry = Effect.fnUntraced(function* (data: ConnectionCommandData) {
  const acted = yield* actedNow;
  const { state } = yield* (yield* OrgWriter).execute(connectionsStream, registryDecider, { ...data, ...acted });
  return yield* Effect.orDie(findConnection(state, data.connection));
});
