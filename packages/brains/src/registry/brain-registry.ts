import type { Decider } from '@beonauto/operations';

import type { BrainCommand } from './brain-commands.ts';
import { BrainEventSchema, type BrainEvent } from './brain-events.ts';
import { decideOnRegistry } from './registry-decisions.ts';
import { emptyRegistry, evolveRegistry, type Registry } from './registry.ts';

export const brainRegistry: Decider<Registry, BrainCommand, BrainEvent, 'not_found' | 'conflict'> = {
  initialState: emptyRegistry,
  evolve: evolveRegistry,
  decide: decideOnRegistry,
  eventSchema: BrainEventSchema,
};
