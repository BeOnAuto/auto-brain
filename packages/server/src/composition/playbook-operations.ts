import {
  makeDefinitionOperations,
  makeDefinitionPresenters,
  publishEvent,
  type PlaybookOperation,
  type Capability,
} from '@beonauto/definitions';
import { conversationCallPresenter, toolTestPresenter } from '@beonauto/mcp';
import type { Presenter } from '@beonauto/operations';
import { defineListPlaybookEvents } from '@beonauto/playbooks';

export function playbookOperationsServing(
  capabilities: readonly Capability[],
  logPresenters: readonly Presenter[],
): readonly PlaybookOperation[] {
  const presenters = [
    ...makeDefinitionPresenters(capabilities),
    toolTestPresenter,
    conversationCallPresenter,
    ...logPresenters,
  ];
  return [...makeDefinitionOperations(capabilities, presenters), defineListPlaybookEvents(presenters), publishEvent];
}
