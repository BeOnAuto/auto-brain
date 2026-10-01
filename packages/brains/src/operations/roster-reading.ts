import { OrgReader } from '@beonauto/operations';
import { Effect } from 'effect';

import { brainRoster } from '../roster/brain-roster.ts';
import { brainsStream } from '../roster/brains-stream.ts';
import type { Roster } from '../roster/roster.ts';

export const readRoster: Effect.Effect<Roster, never, OrgReader> = Effect.gen(function* () {
  const { state } = yield* (yield* OrgReader).load(brainsStream, brainRoster);
  return state;
});
