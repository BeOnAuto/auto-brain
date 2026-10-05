import { counted, listed, type Noun } from '@beonauto/operations';

import { aliasPatternOf } from '../model/model-alias.ts';
import type { ModelEntry, ModelList } from './model-list.ts';

const modelNoun: Noun = { one: 'model', other: 'models' };

const mostNamed = 20;

const trailingSlashes = /\/+$/u;

const everythingToTheLastSlash = /^.*\//u;

function lastPartOf(text: string): string {
  return text.replace(trailingSlashes, '').replace(everythingToTheLastSlash, '');
}

function nameOf({ id, name }: ModelEntry): string {
  return name ?? lastPartOf(id);
}

function anyModelOf({ id }: ModelEntry): string {
  const prefix = aliasPatternOf(id).prefix;
  const split = prefix.indexOf('/');
  const provider = prefix.slice(0, split);
  const start = prefix.slice(split + 1);
  return start === '' ? `any ${provider} model` : `any ${provider} model starting with ${lastPartOf(start)}`;
}

function namesOf(entries: readonly ModelEntry[]): string {
  const named = entries.slice(0, mostNamed).map((entry) => nameOf(entry));
  const others = entries.length - named.length;
  return listed(others === 0 ? named : [...named, `${others} more`]);
}

function providersOf(entries: readonly ModelEntry[]): string {
  return listed([...new Set(entries.map(({ owned_by: ownedBy }) => ownedBy))]);
}

function modelsWords(models: readonly ModelEntry[]): string {
  return models.length === 0
    ? ''
    : `This server can call ${counted(models.length, modelNoun)} through ${providersOf(models)}: ${namesOf(models)}.`;
}

function patternWords(patterns: readonly ModelEntry[], afterModels: boolean): string {
  if (patterns.length === 0) {
    return '';
  }
  const opening = afterModels ? 'It can also call' : 'This server can call';
  return `${opening} ${listed(patterns.map((entry) => anyModelOf(entry)))}.`;
}

function nothingWords(provider: string | undefined): string {
  return provider === undefined
    ? 'This server has no model it can call.'
    : `This server has no model it can call through ${provider}.`;
}

const incomplete = 'The list may be incomplete: a provider could not be asked just now.';

export function modelsListed({ data, catalog_status: status }: ModelList, provider?: string): string {
  const models = data.filter(({ pattern }) => pattern !== true);
  const patterns = data.filter(({ pattern }) => pattern === true);
  const words = [
    data.length === 0 ? nothingWords(provider) : modelsWords(models),
    patternWords(patterns, models.length > 0),
    status === 'partial' ? incomplete : '',
  ];
  return words.filter((sentence) => sentence !== '').join(' ');
}
