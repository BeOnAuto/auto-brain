import { Caller, OrgWriter } from '@beonauto/operations';
import { DateTime, Effect } from 'effect';

import type { BrainCommandData } from '../registry/brain-commands.ts';
import { brainRegistry } from '../registry/brain-registry.ts';
import { brainsStream } from '../registry/brains-stream.ts';
import { findBrain } from '../registry/registry-lookup.ts';

export const recordInRegistry = Effect.fnUntraced(function* (data: BrainCommandData) {
  const { id: by } = yield* Caller;
  const at = DateTime.formatIso(yield* DateTime.now);
  const { state } = yield* (yield* OrgWriter).execute(brainsStream, brainRegistry, { ...data, by, at });
  return yield* Effect.orDie(findBrain(state, data.brain));
});
