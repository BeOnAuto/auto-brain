import {
  bulletList,
  definitionResourceLabel,
  named,
  paragraph,
  sectionOf,
  type OverviewSection,
  type Phrases,
} from '@on.auto/definitions';
import { allTaskEntries, field, kindOf, textField, type JsonObject, type TaskEntry } from '@on.auto/workflow-engine';

import { runDefinitionFunction } from '../document/workflow-functions.ts';
import { literalText, objectAt } from '../steps/task-reading.ts';

interface Called {
  readonly key: string;
  readonly words: Phrases;
}

function calledBy({ name, task, reference }: TaskEntry): Called {
  const using = objectAt(task, 'with');
  const type = literalText(field(using, 'type'));
  const definition = literalText(field(using, 'name'));
  return type === undefined || definition === undefined
    ? { key: reference, words: ['the definition that its step ', named(name), ' names when it runs'] }
    : { key: `${type}/${definition}`, words: [`the ${definitionResourceLabel(type)} `, named(definition)] };
}

function isACall({ task }: TaskEntry): boolean {
  return kindOf(task) === 'call' && textField(task, 'call') === runDefinitionFunction;
}

export function calledSection(document: JsonObject): OverviewSection {
  const called = new Map(
    allTaskEntries(field(document, 'do'), '/do')
      .filter((entry) => isACall(entry))
      .map((entry) => calledBy(entry))
      .map(({ key, words }) => [key, words] as const),
  );
  return called.size === 0
    ? sectionOf('What it calls', paragraph('It calls no function or workflow.'))
    : sectionOf('What it calls', paragraph('Its steps call:'), bulletList([...called.values()]));
}
