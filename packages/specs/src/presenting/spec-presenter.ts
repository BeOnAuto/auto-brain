import { Buffer } from 'node:buffer';

import type { Presenter } from '@beonauto/operations';

import { jsonBytesOf } from '../execution/recorded-size.ts';
import { specCreated, specRetired, specUpdated } from '../plain-language/event-words.ts';
import type { SpecWords } from '../plain-language/spec-words.ts';
import { SpecEventSchema, type SpecContent, type SpecEvent } from '../registry/spec-events.ts';
import { cutAtCodePoint, firstCharacters, mostCallerBytes, mostDescriptionCharacters } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

function contentShown({ source, description, input_schema, output_schema, warnings = [] }: SpecContent) {
  return {
    source_bytes: Buffer.byteLength(source, 'utf8'),
    ...(description === undefined ? {} : { description: firstCharacters(description, mostDescriptionCharacters) }),
    ...(input_schema === undefined ? {} : { input_schema_bytes: jsonBytesOf(input_schema) }),
    ...(output_schema === undefined ? {} : { output_schema_bytes: jsonBytesOf(output_schema) }),
    warning_count: warnings.length,
  };
}

function accountOf(words: SpecWords, event: SpecEvent, primitive: string): Account {
  const { name } = event;
  const fact = { primitive, name, by: cutAtCodePoint(event.by, mostCallerBytes) };
  if (event.type === 'spec_retired') {
    return { summary: specRetired(words, primitive, name), data: fact };
  }
  const { version, content } = event;
  return {
    summary:
      event.type === 'spec_created'
        ? specCreated(words, primitive, name)
        : specUpdated(words, primitive, name, version),
    data: { ...fact, version, ...contentShown(content) },
  };
}

export function specPresenter(words: SpecWords): Presenter {
  return eventPresenter<SpecEvent['type'], SpecEvent>({
    streamKind: 'specs',
    eventSchema: SpecEventSchema,
    publicNames: { spec_created: ['spec_created'], spec_updated: ['spec_updated'], spec_retired: ['spec_retired'] },
    account: (event, primitive) => accountOf(words, event, primitive),
  });
}
