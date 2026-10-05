import { presentationOf, type RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeSpecPresenters } from '../index.ts';
import { SpecEventSchema, type SpecEvent } from '../registry/spec-events.ts';
import { echo } from '../testing/echo.ts';

const { present } = presentationOf(makeSpecPresenters([echo]));

const encode = Schema.encodeSync(Schema.toCodecJson(SpecEventSchema));

const fact = { name: 'greet', by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

function presented(event: SpecEvent, primitive = 'echo') {
  const record: RecordedEvent = {
    id: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ',
    stream: `specs/${primitive}`,
    type: event.type,
    data: encode(event),
    recordedAt: '2026-10-01T09:00:00.000Z',
  };
  return present(record);
}

const shown = { id: 'WyJicmFpbi9hY21lL2FscGhhLyIsIjEiXQ', at: '2026-10-01T09:00:00.000Z' };

describe('the presenter of the specs of a primitive', () => {
  it('presents a spec created with the size of its document and what its primitive said of it', () => {
    const content = {
      source: '{"greeting":"Hé"}',
      description: 'Greets',
      input_schema: { type: 'object' },
      output_schema: { type: 'string' },
      warnings: ['one', 'two'],
    };

    expect(presented({ type: 'spec_created', version: 1, content, ...fact })).toEqual({
      ...shown,
      type: 'spec_created',
      summary: 'The greeting “greet” was created.',
      data: {
        primitive: 'echo',
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

describe('the presenter of the changes to a spec', () => {
  it('presents an update with its version, and a document its primitive said little of', () => {
    expect(presented({ type: 'spec_updated', version: 150, content: { source: 'Hi' }, ...fact })).toEqual({
      ...shown,
      type: 'spec_updated',
      summary: 'The greeting “greet” was updated to version one hundred and fifty.',
      data: { primitive: 'echo', name: 'greet', by: 'acme-admin', version: 150, source_bytes: 2, warning_count: 0 },
    });
  });

  it('presents a retirement, and names a spec of a primitive the server does not offer as an item', () => {
    expect(presented({ type: 'spec_retired', ...fact }, 'gone')).toEqual({
      ...shown,
      type: 'spec_retired',
      summary: 'The item “greet” was retired.',
      data: { primitive: 'gone', name: 'greet', by: 'acme-admin' },
    });
  });

  it('shows the first three hundred characters of a description', () => {
    const description = `${'😀'.repeat(299)}ab`;

    expect(
      presented({ type: 'spec_created', version: 1, content: { source: 'Hi', description }, ...fact }),
    ).toMatchObject({ data: { description: `${'😀'.repeat(299)}a` } });
  });
});
