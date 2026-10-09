import { templateEngine, type TagDefinition } from '@beonauto/definitions/template';

import { clip, money, words } from './prompt-filters.ts';

export const instructionsBegin = Symbol('instructions begin');

export const instructionsEnd = Symbol('instructions end');

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

export const engine = templateEngine(() => ({
  filters: { money, clip, words },
  tags: { system: marker('system', instructionsBegin), endsystem: marker('endsystem', instructionsEnd) },
}));
