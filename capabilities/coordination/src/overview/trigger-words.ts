import {
  durationInWords,
  listedPhrases,
  named,
  type Phrases,
  type Trigger,
  type TriggerFilter,
} from '@on.auto/definitions';
import { alternatives, capitalized } from '@on.auto/operations';
import { enclosedBody, type Json, type JsonEntry } from '@on.auto/workflow-engine';

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

function writtenValue(value: Json): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function attributePhrases([name, value]: JsonEntry): Phrases {
  const test = name === 'data' ? enclosedBody(value) : undefined;
  return test === undefined
    ? [`whose ${name} is `, { code: writtenValue(value) }]
    : ['whose data passes ', { code: test.trim() }];
}

function filterPhrases({ type, attributes }: TriggerFilter): Phrases {
  const tests = Object.entries(attributes)
    .filter(([name]: JsonEntry) => name !== 'type')
    .map((attribute: JsonEntry) => attributePhrases(attribute));
  return [named(type), ...(tests.length === 0 ? [] : [' ', ...listedPhrases(tests, 'and')])];
}

function eventStart(filters: readonly TriggerFilter[]): Start {
  const each = filters.map((filter) => filterPhrases(filter));
  return {
    label: `On ${alternatives(filters.map(({ type }) => type))}`,
    words: ['On each event ', ...listedPhrases(each, 'or')],
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
