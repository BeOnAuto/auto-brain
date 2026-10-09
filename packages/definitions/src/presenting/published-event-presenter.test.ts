import { presentationOf, type RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { EventPublishedSchema, publishedEventStreamOf, type EventPublished } from '../events/published-events.ts';
import { makeDefinitionPresenters } from '../index.ts';
import { echo } from '../testing/echo.ts';

const { present } = presentationOf(makeDefinitionPresenters([echo]));

const encode = Schema.encodeSync(Schema.toCodecJson(EventPublishedSchema));

const recordId = 'WyJicmFpbi9hY21lL2FscGhhLyIsIjMiXQ';

function recorded(published: EventPublished): RecordedEvent {
  return {
    id: '5c6f1a43-0d6e-5b2a-9c1e-7e3f2a1b0c9d',
    cursor: recordId,
    causationId: null,
    correlationId: null,
    stream: publishedEventStreamOf(published.event.source, published.event.id),
    version: 1,
    type: published.type,
    data: encode(published),
    recordedAt: '2026-10-01T09:00:02.000Z',
  };
}

describe('the presenter of a published event', () => {
  it('shows its id, type, source and time, and leaves out a subject and data it does not have', () => {
    const published: EventPublished = {
      type: 'event_published',
      event: {
        specversion: '1.0',
        id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
        source: 'https://acme.example/ledger',
        type: 'com.acme.ledger.opened',
        time: '2026-10-01T09:00:01.000Z',
      },
      filled: ['id', 'time'],
      by: 'acme-admin',
      at: '2026-10-01T09:00:01.000Z',
    };

    expect(present(recorded(published))).toEqual([
      {
        id: '5c6f1a43-0d6e-5b2a-9c1e-7e3f2a1b0c9d',
        cursor: recordId,
        causation_id: null,
        at: '2026-10-01T09:00:01.000Z',
        type: 'event_published',
        summary: 'The event “com.acme.ledger.opened” was published to the brain.',
        data: {
          event_id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
          event_type: 'com.acme.ledger.opened',
          source: 'https://acme.example/ledger',
          time: '2026-10-01T09:00:01.000Z',
          filled: ['id', 'time'],
          by: 'acme-admin',
        },
      },
    ]);
  });
});
