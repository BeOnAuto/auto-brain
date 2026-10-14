import { named, paragraph, type OverviewBlock, type Phrase, type Phrases } from '@on.auto/definitions';
import { counted, listed } from '@on.auto/operations';

import type { ReplyRule, RulePart } from '../replies/reply-rule.ts';

type MeaningWords = readonly [string, readonly string[]];

const second = 1000;

const units = [
  { per: 86_400_000, noun: { one: 'day', other: 'days' } },
  { per: 3_600_000, noun: { one: 'hour', other: 'hours' } },
  { per: 60_000, noun: { one: 'minute', other: 'minutes' } },
  { per: second, noun: { one: 'second', other: 'seconds' } },
] as const;

export function durationInWords(milliseconds: number): string {
  const parts: string[] = [];
  let rest = milliseconds;
  for (const { per, noun } of units) {
    const count = per === second ? rest / per : Math.floor(rest / per);
    rest -= count * per;
    parts.push(...(count > 0 ? [counted(count, noun)] : []));
  }
  return listed(parts);
}

export function partyBlocks(lead: string, blocks: readonly OverviewBlock[]): readonly OverviewBlock[] {
  const [only, ...more] = blocks;
  return only !== undefined && only.kind === 'paragraph' && more.length === 0
    ? [paragraph(`${lead} `, ...only.phrases, '.')]
    : [paragraph(`${lead} the party this names:`), ...blocks];
}

function inSeries(items: readonly Phrases[], lastSeparator: string): Phrases {
  const last = items.length - 1;
  const series: Phrase[] = [];
  for (const [index, item] of items.entries()) {
    series.push(...(index === 0 ? [] : [index === last ? lastSeparator : ', ']), ...item);
  }
  return series;
}

function valuePhrases([value, words]: MeaningWords): Phrases {
  return words.length === 0
    ? [{ code: value }]
    : [
        { code: value },
        ' (or ',
        ...inSeries(
          words.map((word) => [{ code: word }]),
          ', ',
        ),
        ')',
      ];
}

const wholePartWords = {
  rest: ', from the words that follow the first',
  text: ', from the whole reply',
} as const;

function partPhrases(property: string, part: RulePart): Phrases {
  if (part.from !== 'word') {
    return [named(property), wholePartWords[part.from]];
  }
  const values = Object.entries(part.words).map((meaning: MeaningWords) => valuePhrases(meaning));
  return [named(property), ', from the first word of the reply: ', ...inSeries(values, ' or ')];
}

export function replyRuleItems(rule: ReplyRule): readonly Phrases[] {
  return Object.entries(rule).map(([property, part]: readonly [string, RulePart]) => partPhrases(property, part));
}
