import { OrgReader } from '@beonauto/operations';
import { Effect } from 'effect';

import { brainsStream } from '../registry/brains-stream.ts';
import { registryDecider } from '../registry/registry-decider.ts';
import type { Registry } from '../registry/registry.ts';

export const loadRegistry: Effect.Effect<Registry, never, OrgReader> = Effect.gen(function* () {
  const { state } = yield* (yield* OrgReader).load(brainsStream, registryDecider);
  return state;
});
