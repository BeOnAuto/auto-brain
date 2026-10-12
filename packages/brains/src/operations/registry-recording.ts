import { Caller, OrgWriter } from '@beonauto/operations';
import { DateTime, Effect } from 'effect';

import type { PlaybookCommandData } from '../registry/brain-commands.ts';
import { playbooksStream } from '../registry/brains-stream.ts';
import { registryDecider } from '../registry/registry-decider.ts';
import { findPlaybook } from '../registry/registry-lookup.ts';

export const recordInRegistry = Effect.fnUntraced(function* (data: PlaybookCommandData) {
  const { id: by } = yield* Caller;
  const at = DateTime.formatIso(yield* DateTime.now);
  const { state } = yield* (yield* OrgWriter).execute(playbooksStream, registryDecider, { ...data, by, at });
  return yield* Effect.orDie(findPlaybook(state, data.playbook));
});
