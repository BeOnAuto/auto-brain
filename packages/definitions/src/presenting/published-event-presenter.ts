import type { Presenter, Recorded } from '@beonauto/operations';

import { EventPublishedSchema, type EventPublished } from '../events/published-events.ts';
import { eventEmitted, eventPublished } from '../plain-language/event-words.ts';
import { cutAtCodePoint, mostDetailBytes, mostNameBytes } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

function summaryOf(type: string, { runId, definitionName }: Recorded<EventPublished>['context']): string {
  return runId === undefined || definitionName === undefined
    ? eventPublished(type)
    : eventEmitted(type, cutAtCodePoint(definitionName, mostNameBytes));
}

function accountOf({ data, context }: Recorded<EventPublished>): Account {
  const { event, filled } = data;
  const type = cutAtCodePoint(event.type, mostNameBytes);
  return {
    summary: summaryOf(type, context),
    data: {
      event_id: cutAtCodePoint(event.id, mostNameBytes),
      event_type: type,
      source: cutAtCodePoint(event.source, mostDetailBytes),
      ...(event.subject === undefined ? {} : { subject: cutAtCodePoint(event.subject, mostDetailBytes) }),
      time: event.time,
      ...(event.data === undefined ? {} : { data: event.data }),
      filled,
    },
  };
}

export const publishedEventPresenter: Presenter = eventPresenter<EventPublished>({
  streamKind: 'events',
  eventSchema: EventPublishedSchema,
  types: ['event_published'],
  account: accountOf,
});
