import type { Decider } from '@beonauto/operations';

import { decideOnSpecs } from './registry-decisions.ts';
import type { SpecCommand } from './spec-commands.ts';
import { SpecEventSchema, type SpecEvent } from './spec-events.ts';
import { evolveRegistry, initialRegistry, type SpecRegistry } from './spec-registry.ts';

export function specsDecider(
  primitive: string,
): Decider<SpecRegistry, SpecCommand, SpecEvent, 'not_found' | 'conflict'> {
  return {
    initialState: initialRegistry,
    evolve: evolveRegistry,
    decide: (command, registry) => decideOnSpecs(primitive, command, registry),
    eventSchema: SpecEventSchema,
  };
}

export function specsStreamOf(primitive: string): string {
  return `specs/${primitive}`;
}
