import { OrgReader } from '@beonauto/operations';
import { Effect } from 'effect';

import { brainRegistry } from '../registry/brain-registry.ts';
import { brainsStream } from '../registry/brains-stream.ts';
import type { Registry } from '../registry/registry.ts';

export const readRegistry: Effect.Effect<Registry, never, OrgReader> = Effect.gen(function* () {
  const { state } = yield* (yield* OrgReader).load(brainsStream, brainRegistry);
  return state;
});
