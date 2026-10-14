import type { Phrase, Phrases } from './overview.ts';

type Place = 'prose' | 'cell';

const lineBreaks = /[ \t]*\r?\n\s*/gu;

const inlinePunctuation = /[\\`*[\]<>]/gu;

const underscoreAtAWordBoundary = /(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu;

const cellPunctuation = /[\\`|]/gu;

const backtickRuns = /`+/gu;

export function oneLine(text: string): string {
  return text.replaceAll(lineBreaks, ' ');
}

export function escapedInline(text: string): string {
  return oneLine(text).trim().replaceAll(inlinePunctuation, '\\$&').replaceAll(underscoreAtAWordBoundary, '\\_');
}

function codeSpan(text: string): string {
  const line = oneLine(text);
  const longestRun = Math.max(0, ...(line.match(backtickRuns) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longestRun + 1);
  const padded = line.startsWith('`') || line.endsWith('`') ? ` ${line} ` : line;
  return `${fence}${padded}${fence}`;
}

function withPipesEscaped(text: string, place: Place): string {
  return place === 'cell' ? text.replaceAll('|', '\\|') : text;
}

function writtenText(text: string, place: Place): string {
  return place === 'cell' ? oneLine(text).replaceAll(cellPunctuation, '\\$&') : text;
}

function phraseText(phrase: Phrase, place: Place): string {
  if (typeof phrase === 'string') {
    return writtenText(phrase, place);
  }
  if ('name' in phrase) {
    return `**${withPipesEscaped(escapedInline(phrase.name), place)}**`;
  }
  if ('emphasis' in phrase) {
    return `*${withPipesEscaped(escapedInline(phrase.emphasis), place)}*`;
  }
  return withPipesEscaped(codeSpan(phrase.code), place);
}

export function phrasesText(phrases: Phrases, place: Place): string {
  return phrases.map((phrase) => phraseText(phrase, place)).join('');
}
