import { Caller, OrgWriter } from '@beonauto/operations';
import { DateTime, Effect } from 'effect';

import type { BrainIntent } from '../roster/brain-commands.ts';
import { brainRoster } from '../roster/brain-roster.ts';
import { brainsStream } from '../roster/brains-stream.ts';
import { brainIn } from '../roster/roster-lookup.ts';

export const recordOnRoster = Effect.fnUntraced(function* (intent: BrainIntent) {
  const { id: by } = yield* Caller;
  const at = DateTime.formatIso(yield* DateTime.now);
  const { state } = yield* (yield* OrgWriter).execute(brainsStream, brainRoster, { ...intent, by, at });
  return yield* Effect.orDie(brainIn(state, intent.brain));
});
