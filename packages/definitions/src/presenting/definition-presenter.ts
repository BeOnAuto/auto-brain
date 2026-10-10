import { Buffer } from 'node:buffer';

import type { Presenter, Recorded } from '@beonauto/operations';

import type { DefinitionWords } from '../plain-language/definition-words.ts';
import { definitionCreated, definitionRetired, definitionUpdated } from '../plain-language/event-words.ts';
import { DefinitionEventSchema, type DefinitionContent, type DefinitionEvent } from '../registry/definition-events.ts';
import { definitionNameOf } from '../registry/definition-registry.ts';
import { jsonBytesOf } from '../runs/recorded-size.ts';
import { firstCharacters, mostDescriptionCharacters } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

function contentShown({ source, description, input_schema, output_schema, warnings = [] }: DefinitionContent) {
  return {
    source_bytes: Buffer.byteLength(source, 'utf8'),
    ...(description === undefined ? {} : { description: firstCharacters(description, mostDescriptionCharacters) }),
    ...(input_schema === undefined ? {} : { input_schema_bytes: jsonBytesOf(input_schema) }),
    ...(output_schema === undefined ? {} : { output_schema_bytes: jsonBytesOf(output_schema) }),
    warning_count: warnings.length,
  };
}

function accountOf(words: DefinitionWords, event: Recorded<DefinitionEvent>, definitionType: string): Account {
  const name = definitionNameOf(event.context);
  if (event.type === 'definition_retired') {
    return { summary: definitionRetired(words, definitionType, name), data: {} };
  }
  const { definitionVersion: version = 1 } = event.context;
  return {
    summary:
      event.type === 'definition_created'
        ? definitionCreated(words, definitionType, name)
        : definitionUpdated(words, definitionType, name, version),
    data: contentShown(event.data.content),
  };
}

export function definitionPresenter(words: DefinitionWords): Presenter {
  return eventPresenter<DefinitionEvent>({
    streamKind: 'definitions',
    eventSchema: DefinitionEventSchema,
    types: ['definition_created', 'definition_updated', 'definition_retired'],
    account: (event, definitionType) => accountOf(words, event, definitionType),
  });
}
