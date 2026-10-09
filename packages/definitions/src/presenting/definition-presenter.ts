import { Buffer } from 'node:buffer';

import type { Presenter } from '@beonauto/operations';

import type { DefinitionWords } from '../plain-language/definition-words.ts';
import { definitionCreated, definitionRetired, definitionUpdated } from '../plain-language/event-words.ts';
import { DefinitionEventSchema, type DefinitionContent, type DefinitionEvent } from '../registry/definition-events.ts';
import { jsonBytesOf } from '../runs/recorded-size.ts';
import { cutAtCodePoint, firstCharacters, mostCallerBytes, mostDescriptionCharacters } from './event-data.ts';
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

function accountOf(words: DefinitionWords, event: DefinitionEvent, definitionType: string): Account {
  const { name } = event;
  const fact = { definition_type: definitionType, name, by: cutAtCodePoint(event.by, mostCallerBytes) };
  if (event.type === 'definition_retired') {
    return { summary: definitionRetired(words, definitionType, name), data: fact };
  }
  const { version, content } = event;
  return {
    summary:
      event.type === 'definition_created'
        ? definitionCreated(words, definitionType, name)
        : definitionUpdated(words, definitionType, name, version),
    data: { ...fact, version, ...contentShown(content) },
  };
}

export function definitionPresenter(words: DefinitionWords): Presenter {
  return eventPresenter<DefinitionEvent['type'], DefinitionEvent>({
    streamKind: 'definitions',
    eventSchema: DefinitionEventSchema,
    publicNames: {
      definition_created: ['definition_created'],
      definition_updated: ['definition_updated'],
      definition_retired: ['definition_retired'],
    },
    account: (event, definitionType) => accountOf(words, event, definitionType),
  });
}
