import {
  definePublishEvent,
  makeDefinitionOperations,
  makeDefinitionPresenters,
  type PlaybookOperation,
  type Capability,
} from '@beonauto/definitions';
import { defineGetEvent, defineListPlaybookEvents } from '@beonauto/playbooks';

import type { ComposedFacts } from './composed-facts.ts';

export function playbookOperationsServing(
  capabilities: readonly Capability[],
  { facts, names }: Pick<ComposedFacts, 'facts' | 'names'>,
): readonly PlaybookOperation[] {
  const presenters = makeDefinitionPresenters(capabilities, facts);
  return [
    ...makeDefinitionOperations(capabilities, facts, presenters),
    defineListPlaybookEvents(presenters),
    defineGetEvent(presenters),
    definePublishEvent(names),
  ];
}
