const conjunction = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

const disjunction = new Intl.ListFormat('en', { style: 'long', type: 'disjunction' });

const plurals = new Intl.PluralRules('en');

const sentenceEnd = /[.!?…]["”’)]*$/u;

export interface Noun {
  readonly one: string;
  readonly other: string;
}

export function quoted(text: string): string {
  return `“${text}”`;
}

export function listed(items: readonly string[]): string {
  return conjunction.format(items);
}

export function alternatives(items: readonly string[]): string {
  return disjunction.format(items);
}

export function counted(count: number, noun: Noun): string {
  return `${count} ${plurals.select(count) === 'one' ? noun.one : noun.other}`;
}

export function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

export function asSentence(text: string): string {
  const trimmed = text.trim();
  return sentenceEnd.test(trimmed) ? trimmed : `${trimmed}.`;
}
