import { Predicate } from 'effect';

import type { ServerTool } from '../listing/tool-server.ts';
import { searchBounds, wordsIn } from './search-terms.ts';

const weights = { name: 3, argument: 2, description: 1 } as const;

const sentenceEnd = /(?<=[.!?])\s|\n/u;

function argumentWordsOf({ input_schema: { properties } }: ServerTool): ReadonlySet<string> {
  const names = Predicate.isObject(properties) ? Object.keys(properties) : [];
  return new Set(names.flatMap((name) => wordsIn(name)));
}

function weightIn(words: ReadonlySet<string>, word: string, weight: number): number {
  return words.has(word) ? weight : 0;
}

export function scoreOf(tool: ServerTool, words: readonly string[]): number {
  const name = new Set(wordsIn(tool.name));
  const argumentNames = argumentWordsOf(tool);
  const description = new Set(wordsIn(tool.description));
  return words.reduce(
    (score, word) =>
      score +
      weightIn(name, word, weights.name) +
      weightIn(argumentNames, word, weights.argument) +
      weightIn(description, word, weights.description),
    0,
  );
}

export function summaryOf(description: string): string {
  const end = description.search(sentenceEnd);
  const first = end === -1 ? description : description.slice(0, end);
  return Array.from(first.trim()).slice(0, searchBounds.summaryCharacters).join('');
}
