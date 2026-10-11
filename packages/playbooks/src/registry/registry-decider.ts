import type { Decider } from '@beonauto/operations';

import type { PlaybookCommand } from './playbook-commands.ts';
import { PlaybookEventSchema, type PlaybookEvent } from './playbook-events.ts';
import { decideOnRegistry } from './registry-decisions.ts';
import { initialRegistry, evolveRegistry, type Registry } from './registry.ts';

export const registryDecider: Decider<Registry, PlaybookCommand, PlaybookEvent, 'not_found' | 'conflict'> = {
  initialState: initialRegistry,
  evolve: evolveRegistry,
  decide: decideOnRegistry,
  eventSchema: PlaybookEventSchema,
};
