import { defineGetEvent, defineListBrainEvents } from '@beonauto/brains';
import {
  makeDefinitionOperations,
  makeDefinitionPresenters,
  publishEvent,
  type BrainOperation,
  type Capability,
} from '@beonauto/definitions';
import { conversationCallPresenter, toolTestPresenter } from '@beonauto/mcp';
import type { Presenter } from '@beonauto/operations';

export function brainOperationsServing(
  capabilities: readonly Capability[],
  logPresenters: readonly Presenter[],
): readonly BrainOperation[] {
  const presenters = [
    ...makeDefinitionPresenters(capabilities),
    toolTestPresenter,
    conversationCallPresenter,
    ...logPresenters,
  ];
  return [
    ...makeDefinitionOperations(capabilities, presenters),
    defineListBrainEvents(presenters),
    defineGetEvent(presenters),
    publishEvent,
  ];
}
