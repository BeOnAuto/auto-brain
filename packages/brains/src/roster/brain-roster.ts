import type { Decider } from '@beonauto/operations';

import type { BrainCommand } from './brain-commands.ts';
import { BrainEventSchema, type BrainEvent } from './brain-events.ts';
import { decideOnRoster } from './roster-decisions.ts';
import { emptyRoster, evolveRoster, type Roster } from './roster.ts';

export const brainRoster: Decider<Roster, BrainCommand, BrainEvent, 'not_found' | 'conflict'> = {
  initialState: emptyRoster,
  evolve: evolveRoster,
  decide: decideOnRoster,
  eventSchema: BrainEventSchema,
};
