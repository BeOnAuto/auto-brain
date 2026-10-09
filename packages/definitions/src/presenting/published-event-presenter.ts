import type { Presenter } from '@beonauto/operations';

import { EventPublishedSchema, type EventPublished } from '../events/published-events.ts';
import { eventEmitted, eventPublished } from '../plain-language/event-words.ts';
import { jsonBytesOf } from '../runs/recorded-size.ts';
import { cutAtCodePoint, mostCallerBytes, mostDetailBytes, mostNameBytes } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

function accountOf({ event, filled, emitted_by: emitter, depth, by }: EventPublished): Account {
  const type = cutAtCodePoint(event.type, mostNameBytes);
  return {
    summary: emitter === undefined ? eventPublished(type) : eventEmitted(type, emitter.workflow),
    data: {
      event_id: cutAtCodePoint(event.id, mostNameBytes),
      event_type: type,
      source: cutAtCodePoint(event.source, mostDetailBytes),
      ...(event.subject === undefined ? {} : { subject: cutAtCodePoint(event.subject, mostDetailBytes) }),
      time: event.time,
      ...(event.data === undefined ? {} : { data_bytes: jsonBytesOf(event.data) }),
      filled,
      ...(emitter === undefined
        ? {}
        : {
            emitted_by: {
              run_id: emitter.run_id,
              workflow: cutAtCodePoint(emitter.workflow, mostNameBytes),
              version: emitter.version,
            },
          }),
      ...(depth === undefined ? {} : { depth }),
      by: cutAtCodePoint(by, mostCallerBytes),
    },
  };
}

export const publishedEventPresenter: Presenter = eventPresenter<EventPublished['type'], EventPublished>({
  streamKind: 'events',
  eventSchema: EventPublishedSchema,
  publicNames: { event_published: ['event_published'] },
  account: accountOf,
});
