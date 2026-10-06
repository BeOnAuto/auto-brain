import { Conflict } from '@beonauto/operations';
import { Effect, Exit, Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { CloudEvent } from './cloud-event.ts';
import {
  publishedEventDecider,
  publishedEventStreamOf,
  recordedPublication,
  type EventPublished,
  type PublishEvent,
} from './published-events.ts';

const nameBasedUuid = /^events\/[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const monthClosed: CloudEvent = {
  specversion: '1.0',
  id: 'm-2026-09',
  source: '/ledger/eu',
  type: 'com.acme.ledger.month-closed',
  subject: 'september',
  time: '2026-10-01T08:59:00Z',
  data: { region: 'eu', totals: { revenue: 120, costs: 80 } },
  tenant: 'acme',
};

const first: PublishEvent = { event: monthClosed, filled: [], by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const published: EventPublished = { type: 'event_published', ...first };

const again = { by: 'acme-admin', at: '2026-10-01T09:05:00.000Z' };

function decidedAfter(publish: PublishEvent, recorded: EventPublished = published) {
  return publishedEventDecider.decide(publish, publishedEventDecider.evolve(undefined, recorded));
}

const anotherEvent = Result.fail(
  new Conflict({
    detail: 'Another event was published with this source and id; give a different event an id of its own',
  }),
);

describe('the stream of a published event', () => {
  it('is named by a name-based UUID of its source and id, the same for the same pair', () => {
    const stream = publishedEventStreamOf('/ledger/eu', 'm-2026-09');

    expect(stream).toMatch(nameBasedUuid);
    expect(publishedEventStreamOf('/ledger/eu', 'm-2026-09')).toBe(stream);
  });

  it('differs for another source or another id, however the two are split', () => {
    const streams = new Set([
      publishedEventStreamOf('/ledger/eu', 'm-2026-09'),
      publishedEventStreamOf('/ledger/us', 'm-2026-09'),
      publishedEventStreamOf('/ledger/eu', 'm-2026-10'),
      publishedEventStreamOf('/ledger/e', 'um-2026-09'),
    ]);

    expect(streams.size).toBe(4);
  });
});

describe('publishing an event', () => {
  it('records it on a stream nobody wrote', () => {
    expect(publishedEventDecider.decide(first, publishedEventDecider.initialState)).toStrictEqual(
      Result.succeed([published]),
    );
  });

  it('records nothing for the same event again, in any order of its keys', () => {
    const reordered = Object.fromEntries(Object.entries(monthClosed).toReversed());

    expect(decidedAfter({ ...first, ...again })).toStrictEqual(Result.succeed([]));
    expect(decidedAfter({ ...first, event: { ...monthClosed, ...reordered }, ...again })).toStrictEqual(
      Result.succeed([]),
    );
  });

  it('compares only what both callers gave, so a time the brain filled in on either side is left out', () => {
    const later = { ...monthClosed, time: '2026-10-01T09:05:00.000Z' };
    const timeFilledFirst: EventPublished = { ...published, filled: ['time'] };

    expect(decidedAfter({ event: later, filled: ['time'], ...again })).toStrictEqual(Result.succeed([]));
    expect(decidedAfter({ event: later, filled: [], ...again }, timeFilledFirst)).toStrictEqual(Result.succeed([]));
    expect(decidedAfter({ event: later, filled: [], ...again })).toStrictEqual(anotherEvent);
  });

  it('is refused for a different event under the same source and id', () => {
    const { subject: _subject, ...withoutSubject } = monthClosed;

    expect(decidedAfter({ ...first, event: { ...monthClosed, data: { region: 'us' } }, ...again })).toStrictEqual(
      anotherEvent,
    );
    expect(decidedAfter({ ...first, event: withoutSubject, ...again })).toStrictEqual(anotherEvent);
    expect(decidedAfter({ ...first, event: { ...monthClosed, tenant: 'globex' }, ...again })).toStrictEqual(
      anotherEvent,
    );
  });
});

describe('the publication a stream holds', () => {
  it('is the event it recorded, and a defect when it holds none', async () => {
    expect(await Effect.runPromise(recordedPublication(published))).toBe(published);
    expect(Exit.isFailure(await Effect.runPromiseExit(recordedPublication(publishedEventDecider.initialState)))).toBe(
      true,
    );
  });
});
