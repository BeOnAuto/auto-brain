import { Liquid } from 'liquidjs';

import { clip, money, words } from './prompt-filters.ts';

export const templateLimits = {
  characters: 65_536,
  names: 1000,
  renderMilliseconds: 200,
  memory: 5_000_000,
  renderedCharacters: 200_000,
} as const;

export const instructionsBegin = Symbol('instructions begin');

export const instructionsEnd = Symbol('instructions end');

const keptFilters: ReadonlySet<string> = new Set([
  'abs',
  'append',
  'array_to_sentence_string',
  'at_least',
  'at_most',
  'base64_decode',
  'base64_encode',
  'capitalize',
  'ceil',
  'compact',
  'concat',
  'default',
  'divided_by',
  'downcase',
  'escape',
  'escape_once',
  'find',
  'find_index',
  'first',
  'floor',
  'group_by',
  'has',
  'join',
  'json',
  'last',
  'lstrip',
  'map',
  'minus',
  'modulo',
  'newline_to_br',
  'normalize_whitespace',
  'number_of_words',
  'plus',
  'pop',
  'prepend',
  'push',
  'raw',
  'reject',
  'remove',
  'remove_first',
  'remove_last',
  'replace',
  'replace_first',
  'replace_last',
  'reverse',
  'round',
  'rstrip',
  'shift',
  'size',
  'slice',
  'slugify',
  'sort',
  'sort_natural',
  'split',
  'squish',
  'strip',
  'strip_newlines',
  'sum',
  'times',
  'to_integer',
  'truncate',
  'truncatewords',
  'uniq',
  'unshift',
  'upcase',
  'where',
  'xml_escape',
]);

const removedTags = ['include', 'render', 'layout', 'block', 'capture'] as const;

type TagDefinition = Parameters<Liquid['registerTag']>[1];

function marker(name: string, sentinel: symbol): TagDefinition {
  return {
    parse() {
      if (this.token.args.trim() !== '') {
        throw new Error(`{% ${name} %} takes no arguments`);
      }
    },
    render: () => sentinel,
  };
}

function configuredEngine(): Liquid {
  const liquid = new Liquid({
    templates: {},
    strictFilters: true,
    strictVariables: true,
    lenientIf: true,
    ownPropertyOnly: true,
    parseLimit: templateLimits.characters,
    renderLimit: templateLimits.renderMilliseconds,
    memoryLimit: templateLimits.memory,
  });
  for (const name of Object.keys(liquid.filters).filter((filter) => !keptFilters.has(filter))) {
    liquid.unregisterFilter(name);
  }
  for (const name of removedTags) {
    Reflect.deleteProperty(liquid.tags, name);
  }
  liquid.registerFilter('money', money);
  liquid.registerFilter('clip', clip);
  liquid.registerFilter('words', words);
  liquid.registerTag('system', marker('system', instructionsBegin));
  liquid.registerTag('endsystem', marker('endsystem', instructionsEnd));
  return liquid;
}

export const engine = configuredEngine();
