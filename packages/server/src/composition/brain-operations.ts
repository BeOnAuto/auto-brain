import { defineGetEvent, defineListBrainEvents } from '@beonauto/brains';
import {
  definePublishEvent,
  makeDefinitionOperations,
  makeDefinitionPresenters,
  type BrainOperation,
  type Capability,
} from '@beonauto/definitions';

import type { ComposedFacts } from './composed-facts.ts';

export function brainOperationsServing(
  capabilities: readonly Capability[],
  { facts, names }: Pick<ComposedFacts, 'facts' | 'names'>,
): readonly BrainOperation[] {
  const presenters = makeDefinitionPresenters(capabilities, facts);
  return [
    ...makeDefinitionOperations(capabilities, facts, presenters),
    defineListBrainEvents(presenters),
    defineGetEvent(presenters),
    definePublishEvent(names),
  ];
}
