import { presentationOf, type RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeDefinitionPresenters } from '../index.ts';
import { DefinitionEventSchema, type DefinitionEvent } from '../registry/definition-events.ts';
import { echo } from '../testing/echo.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

const encode = Schema.encodeSync(Schema.toCodecJson(DefinitionEventSchema));

const fact = { name: 'greet', by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

function presented(event: DefinitionEvent, type = 'echo') {
  const record: RecordedEvent = {
    id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
    cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    causationId: null,
    correlationId: null,
    stream: `definitions/${type}`,
    version: 1,
    type: event.type,
    data: encode(event),
    recordedAt: '2026-10-01T09:00:00.000Z',
  };
  return present(record).at(0);
}

const shown = {
  id: '0b1c2d3e-4f50-5a6b-8c7d-8e9fa0b1c2d3',
  cursor: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
  causation_id: null,
  at: '2026-10-01T09:00:00.000Z',
};

describe('the presenter of the definitions of a capability', () => {
  it('presents a definition created with the size of its document and what its capability said of it', () => {
    const content = {
      source: '{"greeting":"Hé"}',
      description: 'Greets',
      input_schema: { type: 'object' },
      output_schema: { type: 'string' },
      warnings: ['one', 'two'],
    };

    expect(presented({ type: 'definition_created', version: 1, content, ...fact })).toEqual({
      ...shown,
      type: 'definition_created',
      summary: 'The greeting “greet” was created.',
      data: {
        type: 'echo',
        name: 'greet',
        by: 'acme-admin',
        version: 1,
        source_bytes: 18,
        description: 'Greets',
        input_schema_bytes: 17,
        output_schema_bytes: 17,
        warning_count: 2,
      },
    });
  });
});

describe('the presenter of the changes to a definition', () => {
  it('presents an update with its version, and a document its capability said little of', () => {
    expect(presented({ type: 'definition_updated', version: 150, content: { source: 'Hi' }, ...fact })).toEqual({
      ...shown,
      type: 'definition_updated',
      summary: 'The greeting “greet” was updated to version one hundred and fifty.',
      data: { type: 'echo', name: 'greet', by: 'acme-admin', version: 150, source_bytes: 2, warning_count: 0 },
    });
  });

  it('presents a retirement, and names a definition of a capability the server does not offer as an item', () => {
    expect(presented({ type: 'definition_retired', ...fact }, 'gone')).toEqual({
      ...shown,
      type: 'definition_retired',
      summary: 'The item “greet” was retired.',
      data: { type: 'gone', name: 'greet', by: 'acme-admin' },
    });
  });

  it('shows the first three hundred characters of a description', () => {
    const description = `${'😀'.repeat(299)}ab`;

    expect(
      presented({ type: 'definition_created', version: 1, content: { source: 'Hi', description }, ...fact }),
    ).toMatchObject({ data: { description: `${'😀'.repeat(299)}a` } });
  });
});
