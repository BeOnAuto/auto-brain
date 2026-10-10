import type { Decider } from '@beonauto/operations';

import type { BrainCommand } from './brain-commands.ts';
import { BrainEventSchema, type BrainEvent } from './brain-events.ts';
import { decideOnRegistry, registryContextOf } from './registry-decisions.ts';
import { initialRegistry, evolveRegistry, type Registry } from './registry.ts';

export const registryDecider: Decider<Registry, BrainCommand, BrainEvent, 'not_found' | 'conflict'> = {
  initialState: initialRegistry,
  evolve: evolveRegistry,
  decide: decideOnRegistry,
  context: registryContextOf,
  eventSchema: BrainEventSchema,
};
