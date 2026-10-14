import { listedPhrases, named, paragraph, sectionOf, type OverviewSection, type Phrases } from '@on.auto/definitions';
import { listed, type Noun } from '@on.auto/operations';

import { figure } from '../capability/figures.ts';
import type { DataPart, Predicts } from '../document/prediction-document.ts';
import type { Grain } from '../periods/grains.ts';

const periodNouns: Readonly<Record<Grain, Noun>> = {
  day: { one: 'day', other: 'days' },
  week: { one: 'week', other: 'weeks' },
  month: { one: 'month', other: 'months' },
  quarter: { one: 'quarter', other: 'quarters' },
  year: { one: 'year', other: 'years' },
};

export function periodsOf(period: Grain, count: number): string {
  const { one, other } = periodNouns[period];
  return `${figure(count)} ${count === 1 ? one : other}`;
}

export function askedPeriods({ period, accumulates }: Predicts): string {
  const { other } = periodNouns[period];
  return accumulates === undefined ? `the ${other} ahead` : `the ${other} it sums`;
}

function predictedWords({ target, period, horizons, accumulates, unit }: Predicts): Phrases {
  if (accumulates !== undefined) {
    return [
      'It predicts the total of ',
      named(target),
      `, counted in ${unit}, for each series from the ${period} after the last one closed to the end of the ${accumulates} that ${period} falls in.`,
    ];
  }
  const { one, other } = periodNouns[period];
  const ahead = horizons.length === 1 && horizons[0] === 1 ? one : other;
  return [
    'It predicts ',
    named(target),
    `, counted in ${unit}, for each series a ${period} at a time, ${listed(horizons.map((horizon) => figure(horizon)))} ${ahead} ahead.`,
  ];
}

function seasonWords({ period, season }: Predicts): readonly Phrases[] {
  return season === undefined ? [] : [[`A season is ${periodsOf(period, season)} long.`]];
}

function questionWords(predicts: Predicts, { given }: DataPart): Phrases {
  const asked =
    predicts.accumulates === undefined
      ? `A question names a series and how many ${periodNouns[predicts.period].other} ahead`
      : 'A question names a series';
  const planned =
    given.length === 0
      ? []
      : [
          ', with the value of ',
          ...listedPhrases(
            given.map((name) => [named(name)]),
            'and',
          ),
          ` planned for ${askedPeriods(predicts)}`,
        ];
  return [asked, ...planned, '.'];
}

export function predictedSection(predicts: Predicts, data: DataPart): OverviewSection {
  return sectionOf(
    'What it predicts',
    paragraph(...predictedWords(predicts)),
    ...seasonWords(predicts).map((words) => paragraph(...words)),
    paragraph(...questionWords(predicts, data)),
    paragraph('It answers with a likely value, a low and a high: the 50th, 10th and 90th percentiles of its model.'),
  );
}
