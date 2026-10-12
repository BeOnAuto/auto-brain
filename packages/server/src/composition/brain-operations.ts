import { defineGetEvent, defineListBrainEvents } from '@beonauto/brains';
import {
  definePublishEvent,
  makeDefinitionOperations,
  makeDefinitionPresenters,
  type BrainOperation,
  type BrainOwnNames,
  type Capability,
} from '@beonauto/definitions';

export function brainOperationsServing(
  capabilities: readonly Capability[],
  names: BrainOwnNames,
): readonly BrainOperation[] {
  const presenters = makeDefinitionPresenters(capabilities);
  return [
    ...makeDefinitionOperations(capabilities, presenters),
    defineListBrainEvents(presenters),
    defineGetEvent(presenters),
    definePublishEvent(names),
  ];
}
