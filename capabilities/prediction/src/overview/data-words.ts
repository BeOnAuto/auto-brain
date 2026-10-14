import {
  bulletList,
  listedPhrases,
  named,
  paragraph,
  sectionOf,
  type OverviewBlock,
  type OverviewSection,
  type Phrases,
} from '@on.auto/definitions';
import { enclosedBody } from '@on.auto/workflow-engine/dsl';
import type { Schema } from 'effect';

import {
  isProjected,
  type Aggregation,
  type DatasetFilter,
  type Feature,
  type Measure,
  type PredictionFunctionDefinitionDocument,
  type ProjectedData,
} from '../document/prediction-document.ts';
import { askedPeriods, periodsOf } from './predicts-words.ts';

type Attribute = readonly [string, Schema.Json];

const measureWords: Readonly<Record<Exclude<Aggregation, 'count'>, string>> = {
  sum: 'the sum of ',
  last: 'the last value of ',
  mean: 'the mean of ',
};

function writtenValue(value: Schema.Json): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function attributePhrases([name, value]: Attribute): Phrases {
  const test = name === 'data' ? enclosedBody(value) : undefined;
  return test === undefined
    ? [`whose ${name} is `, { code: writtenValue(value) }]
    : ['whose data passes ', { code: test.trim() }];
}

function filterPhrases({ type, ...attributes }: DatasetFilter): Phrases {
  const tests = Object.entries(attributes).map((attribute: Attribute) => attributePhrases(attribute));
  return ['each event ', named(type), ...(tests.length === 0 ? [] : [' ', ...listedPhrases(tests, 'and')])];
}

function measurePhrases({ of, as }: Measure): Phrases {
  return of === undefined || as === 'count' ? ['the number of its events'] : [measureWords[as], { code: of }];
}

function givenPhrases(name: string, given: readonly string[], asked: string): Phrases {
  return given.includes(name) ? [`, which a question gives for ${asked}`] : [];
}

function featurePhrases({ name, ...measure }: Feature, given: readonly string[], asked: string): Phrases {
  return [named(name), ', ', ...measurePhrases(measure), ...givenPhrases(name, given, asked)];
}

function timePhrases(time: string, period: string): Phrases {
  return time === 'event'
    ? [`the ${period}, from the time of each event`]
    : [`the ${period}, from `, { code: time }, " in each event's data"];
}

function projectedBlocks(
  { events, time, series, target, features, given }: ProjectedData,
  { predicts }: PredictionFunctionDefinitionDocument,
): readonly OverviewBlock[] {
  const asked = askedPeriods(predicts);
  return [
    paragraph('It learns from the rows the playbook folds from its own history, from these events:'),
    bulletList(events.map((filter) => filterPhrases(filter))),
    paragraph(`Each row is one series and one ${predicts.period}, and holds:`),
    bulletList([
      timePhrases(time, predicts.period),
      ['the series, from ', { code: series }],
      [named(predicts.target), ', ', ...measurePhrases(target)],
      ...features.map((feature) => featurePhrases(feature, given, asked)),
    ]),
  ];
}

function uploadedBlocks(
  dataset: string,
  features: readonly string[],
  { predicts, data }: PredictionFunctionDefinitionDocument,
): readonly OverviewBlock[] {
  const asked = askedPeriods(predicts);
  const opening = paragraph(
    'It learns from the dataset uploaded to the playbook as ',
    { code: dataset },
    `, one row a series and a ${predicts.period}, with `,
    named(predicts.target),
    features.length === 0 ? ' alone.' : ' and then these columns:',
  );
  return features.length === 0
    ? [opening]
    : [opening, bulletList(features.map((name) => [named(name), ...givenPhrases(name, data.given, asked)]))];
}

export function learnedSection(document: PredictionFunctionDefinitionDocument): OverviewSection {
  const { data, predicts } = document;
  const blocks = isProjected(data)
    ? projectedBlocks(data, document)
    : uploadedBlocks(data.dataset, data.features, document);
  return sectionOf(
    'What it learns from',
    ...blocks,
    paragraph(`A build reads the last ${periodsOf(predicts.period, data.window)}.`),
  );
}
