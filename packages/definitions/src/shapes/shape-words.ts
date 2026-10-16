import { alternatives } from '@on.auto/operations';

import { named, paragraph, type OverviewBlock, type Phrases } from '../overview/overview.ts';
import { nothing, numbers, text, yesOrNo } from '../overview/schema-nouns.ts';
import { categoriesBounds } from './categories-shape.ts';
import type { OutputShape, OutputShapeName } from './output-shape.ts';
import { seriesBounds } from './series-shape.ts';
import { counted } from './shape-values.ts';
import { tableBounds } from './table-shape.ts';
import { textBounds } from './text-shape.ts';

const withLowAndHigh: Phrases = [', with a ', named('low'), ' and a ', named('high'), ' where given'];

const seriesWords: Phrases = [
  'It answers a series over time, in ',
  named('unit'),
  `: 1 to ${seriesBounds.mostLines} lines, one for each `,
  named('name'),
  `, of at most ${counted.format(seriesBounds.mostPoints)} `,
  named('points'),
  ' in all, each a ',
  named('value'),
  ' at its ',
  named('at'),
  ...withLowAndHigh,
  `, and at most ${seriesBounds.mostMarks} `,
  named('marks'),
  ', each a ',
  named('value'),
  ' with a ',
  named('label'),
  '. Each ',
  named('at'),
  ' is a day, week, month, quarter or year, as ',
  named('period'),
  ' names, or a date and time where it names none, and ',
  named('origin'),
  ' is the last one observed.',
];

const categoriesWords: Phrases = [
  `It answers 1 to ${categoriesBounds.mostValues} `,
  named('values'),
  ', in ',
  named('unit'),
  ', each a ',
  named('value'),
  ' under a ',
  named('name'),
  ' of its own',
  ...withLowAndHigh,
  '.',
];

const cellWords = alternatives([text.one, numbers.one, yesOrNo.one, nothing.one]);

const tableWords: Phrases = [
  `It answers a table of 1 to ${tableBounds.mostColumns} `,
  named('columns'),
  ', each a ',
  named('name'),
  ' of its own with a ',
  named('unit'),
  ` where given, and at most ${tableBounds.mostRows} `,
  named('rows'),
  `, each one cell for each column: ${cellWords}.`,
];

const textWords: Phrases = [
  'It answers a ',
  named('text'),
  `: Markdown of at most ${counted.format(textBounds.mostBytes)} bytes.`,
];

const shapeWords: Readonly<Record<OutputShapeName, Phrases>> = {
  series: seriesWords,
  categories: categoriesWords,
  table: tableWords,
  text: textWords,
};

export function shapeBlocks({ name }: OutputShape): readonly OverviewBlock[] {
  return [paragraph(...shapeWords[name])];
}
