import { NotFound } from '@beonauto/operations';
import { Effect } from 'effect';

import type { Brain } from './brain.ts';
import type { Roster } from './roster.ts';

export function missingBrain(id: string): NotFound {
  return new NotFound({ detail: `There is no brain ${id} in this org` });
}

export function brainIn(roster: Roster, id: string): Effect.Effect<Brain, NotFound> {
  const brain = roster.get(id);
  return brain === undefined ? Effect.fail(missingBrain(id)) : Effect.succeed(brain);
}
