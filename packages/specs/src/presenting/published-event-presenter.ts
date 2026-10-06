import type { Presenter } from '@beonauto/operations';

import { EventPublishedSchema, type EventPublished } from '../events/published-events.ts';
import { jsonBytesOf } from '../execution/recorded-size.ts';
import { eventPublished } from '../plain-language/event-words.ts';
import { cutAtCodePoint, mostCallerBytes, mostDetailBytes, mostNameBytes } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

function accountOf({ event, filled, by }: EventPublished): Account {
  const type = cutAtCodePoint(event.type, mostNameBytes);
  return {
    summary: eventPublished(type),
    data: {
      event_id: cutAtCodePoint(event.id, mostNameBytes),
      event_type: type,
      source: cutAtCodePoint(event.source, mostDetailBytes),
      ...(event.subject === undefined ? {} : { subject: cutAtCodePoint(event.subject, mostDetailBytes) }),
      time: event.time,
      ...(event.data === undefined ? {} : { data_bytes: jsonBytesOf(event.data) }),
      filled,
      by: cutAtCodePoint(by, mostCallerBytes),
    },
  };
}

export const publishedEventPresenter: Presenter = eventPresenter<EventPublished['type'], EventPublished>({
  streamKind: 'events',
  eventSchema: EventPublishedSchema,
  publicNames: { event_published: 'event_published' },
  account: accountOf,
});
