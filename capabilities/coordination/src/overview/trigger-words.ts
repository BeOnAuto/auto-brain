import {
  durationInWords,
  eventFilterPhrases,
  listedPhrases,
  type Phrases,
  type Trigger,
  type TriggerFilter,
} from '@on.auto/definitions';
import { alternatives, capitalized } from '@on.auto/operations';

import { runDefinitionFunction } from '../document/workflow-functions.ts';
import { cronInWords } from './cron-words.ts';

export interface Start {
  readonly label: string;
  readonly words: Phrases;
}

const byACall: Start = {
  label: 'By a call',
  words: ['By a call of ', { code: runDefinitionFunction }, ', from a caller or from a step of another workflow'],
};

function filterPhrases({ type, attributes }: TriggerFilter): Phrases {
  return ['each time ', ...eventFilterPhrases({ ...attributes, type })];
}

function eventStart(filters: readonly TriggerFilter[]): Start {
  const each = filters.map((filter) => filterPhrases(filter));
  return {
    label: `On ${alternatives(filters.map(({ type }) => type))}`,
    words: ['On an event, ', ...listedPhrases(each, 'or')],
  };
}

function cronStart(expression: string): Start {
  const plain = cronInWords(expression);
  return plain === undefined
    ? {
        label: `On the schedule ${expression}`,
        words: ['On the cron schedule ', { code: expression }, ', read in UTC'],
      }
    : { label: capitalized(plain), words: [`On a schedule, ${plain}`] };
}

function startOf(trigger: Trigger): Start {
  if (trigger.kind === 'event') {
    return eventStart(trigger.filters);
  }
  if (trigger.kind === 'cron') {
    return cronStart(trigger.expression);
  }
  const period = durationInWords(trigger.milliseconds);
  return { label: `Every ${period}`, words: [`Every ${period}, counted from when the trigger was saved`] };
}

export function startsOf(triggers: readonly Trigger[]): readonly Start[] {
  return [...triggers.map((trigger) => startOf(trigger)), byACall];
}
