import { defineGetEvent, defineListBrainEvents } from '@beonauto/brains';
import {
  brainOwnNamesOf,
  definePublishEvent,
  makeDefinitionOperations,
  makeDefinitionPresenters,
  type BrainOperation,
  type Capability,
} from '@beonauto/definitions';
import { toolTestPresenter } from '@beonauto/mcp';
import type { Presenter } from '@beonauto/operations';

export function brainOperationsServing(
  capabilities: readonly Capability[],
  logPresenters: readonly Presenter[],
): readonly BrainOperation[] {
  const presenters = [...makeDefinitionPresenters(capabilities), toolTestPresenter, ...logPresenters];
  return [
    ...makeDefinitionOperations(capabilities, presenters),
    defineListBrainEvents(presenters),
    defineGetEvent(presenters),
    definePublishEvent(brainOwnNamesOf(capabilities)),
  ];
}
