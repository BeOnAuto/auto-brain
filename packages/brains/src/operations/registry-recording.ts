import { Caller, OrgWriter } from '@beonauto/operations';
import { DateTime, Effect } from 'effect';

import type { BrainIntent } from '../registry/brain-commands.ts';
import { brainRegistry } from '../registry/brain-registry.ts';
import { brainsStream } from '../registry/brains-stream.ts';
import { brainIn } from '../registry/registry-lookup.ts';

export const recordInRegistry = Effect.fnUntraced(function* (intent: BrainIntent) {
  const { id: by } = yield* Caller;
  const at = DateTime.formatIso(yield* DateTime.now);
  const { state } = yield* (yield* OrgWriter).execute(brainsStream, brainRegistry, { ...intent, by, at });
  return yield* Effect.orDie(brainIn(state, intent.brain));
});
