import type { Presenter } from '@beonauto/operations';

import type { Capability } from '../capability/capability.ts';
import { definitionWordsFor } from '../plain-language/definition-words.ts';
import { composedFactsOf, type CapabilityFacts } from '../run-work/declared-facts.ts';
import { definitionPresenter } from './definition-presenter.ts';
import { publishedEventPresenter } from './published-event-presenter.ts';
import { reactionRefusedPresenter } from './reaction-refused-presenter.ts';
import { runPresenter } from './run-presenter.ts';

export function makeDefinitionPresenters(
  capabilities: readonly Capability[],
  facts: CapabilityFacts = composedFactsOf(capabilities),
): readonly Presenter[] {
  const words = definitionWordsFor(capabilities);
  return [
    runPresenter(words, facts.onRuns),
    definitionPresenter(words),
    publishedEventPresenter,
    reactionRefusedPresenter,
    ...facts.streams,
  ];
}
