import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import {
  brainWideFilterOf,
  listenFiltersOf,
  listenerFilterOf,
  literalFilterOf,
  matchEvent,
  type FilterVerdict,
  type LiteralFilter,
} from './event-filter.ts';

const at = '/schedule/on/one';

const now = Date.parse('2026-10-01T09:00:00.000Z');

const monthClosed: JsonObject = {
  specversion: '1.0',
  id: 'm-2026-09',
  source: '/ledger/eu',
  type: 'com.acme.ledger.month-closed',
  subject: 'september',
  time: '2026-10-01T08:59:00Z',
  data: { region: 'eu', totals: { revenue: 120, costs: 80 } },
};

function filterOf(filter: Json): LiteralFilter {
  const reading = literalFilterOf(filter, at);
  if ('rejections' in reading) {
    throw new Error(`The filter was refused: ${JSON.stringify(reading.rejections)}`);
  }
  return reading.filter;
}

function matched(attributes: JsonObject, event: JsonObject = monthClosed) {
  return matchEvent(filterOf({ with: attributes }), event, now);
}

function rejectionsOf(filter: Json) {
  const reading = literalFilterOf(filter, at);
  return 'rejections' in reading ? reading.rejections : [];
}

describe('an event filter matched over the event alone', () => {
  it('reads as the attributes it tests, at its place in the document', () => {
    expect(
      literalFilterOf(
        { with: { type: 'com.acme.ledger.month-closed', source: '/ledger/eu', data: '${ .region == "eu" }' } },
        at,
      ),
    ).toEqual({
      filter: {
        reference: at,
        type: 'com.acme.ledger.month-closed',
        attributes: { type: 'com.acme.ledger.month-closed', source: '/ledger/eu', data: '${ .region == "eu" }' },
        dataNeedsVariables: false,
      },
    });
  });

  it('leaves out a data expression that reads variables of a run, which only the run can evaluate', () => {
    expect(
      literalFilterOf({ with: { type: 'com.acme.approval.decided', data: '${ .request == $context.request }' } }, at),
    ).toEqual({
      filter: {
        reference: at,
        type: 'com.acme.approval.decided',
        attributes: { type: 'com.acme.approval.decided' },
        dataNeedsVariables: true,
      },
    });
  });
});

describe('matching an event over the event alone', () => {
  it('matches the type, the source and the subject as written', () => {
    expect(matched({ type: 'com.acme.ledger.month-closed' })).toBe(true);
    expect(matched({ type: 'com.acme.ledger.month-closed', source: '/ledger/eu', subject: 'september' })).toBe(true);
    expect(matched({ type: 'com.acme.ledger.month-opened' })).toBe(false);
    expect(matched({ type: 'com.acme.ledger.month-closed', source: '/ledger/us' })).toBe(false);
    expect(matched({ type: 'com.acme.ledger.month-closed', subject: 'october' })).toBe(false);
  });

  it('matches no event that lacks an attribute it names', () => {
    const { subject: _subject, ...withoutSubject } = monthClosed;

    expect(matched({ type: 'com.acme.ledger.month-closed', subject: 'september' }, withoutSubject)).toBe(false);
  });

  it('evaluates a data expression over the data of the event, as a listen task does', () => {
    expect(matched({ type: 'com.acme.ledger.month-closed', data: '${ .region == "eu" }' })).toBe(true);
    expect(matched({ type: 'com.acme.ledger.month-closed', data: '${ .totals.revenue > .totals.costs }' })).toBe(true);
    expect(matched({ type: 'com.acme.ledger.month-closed', data: '${ .region == "us" }' })).toBe(false);
    expect(matched({ type: 'com.acme.ledger.month-closed', data: '${ .missing }' })).toBe(false);
  });

  it('evaluates with the time it is given as now', () => {
    expect(
      matched({ type: 'com.acme.ledger.month-closed', data: '${ (now | todate) == "2026-10-01T09:00:00Z" }' }),
    ).toBe(true);
  });

  it('compares written data as JSON, in any order of keys', () => {
    const data = { totals: { costs: 80, revenue: 120 }, region: 'eu' };

    expect(matched({ type: 'com.acme.ledger.month-closed', data })).toBe(true);
    expect(matched({ type: 'com.acme.ledger.month-closed', data: { region: 'eu' } })).toBe(false);
  });

  it('matches on the rest when its data expression reads variables of a run', () => {
    expect(matched({ type: 'com.acme.ledger.month-closed', data: '${ .region == $context.region }' })).toBe(true);
  });
});

describe('matching an event whose data expression fails', () => {
  it('answers the error a run would raise, at the place of the filter', () => {
    const verdict = matched({ type: 'com.acme.ledger.month-closed', data: '${ .region + 1 }' });

    expect(verdict).toMatchObject({
      error: {
        type: 'https://open-workflow-specification.org/spec/1.0.0/errors/expression',
        status: 400,
        title: 'An expression failed',
        instance: at,
      },
    });
    expect(JSON.stringify(verdict)).toContain(' .region + 1 ');
  });

  it('answers an error for a data expression that does more work than an expression of a workflow may', () => {
    const verdict = matched({ type: 'com.acme.ledger.month-closed', data: '${ ("x" * 100000000) | length > 0 }' });

    expect(verdict).toMatchObject({
      error: { type: 'https://open-workflow-specification.org/spec/1.0.0/errors/runtime', status: 500, instance: at },
    });
    expect(JSON.stringify(verdict)).toContain('an expression may do 8000000 units of work');
  });
});

describe('an event filter that cannot be matched over the event alone', () => {
  it('is refused when it is not a mapping with with', () => {
    const notAFilter = [
      {
        pointer: at,
        detail: 'An event filter is a mapping whose with holds the attributes to match',
        forbidden: false,
      },
    ];

    expect(rejectionsOf(null)).toEqual(notAFilter);
    expect(rejectionsOf('com.acme.ledger.month-closed')).toEqual(notAFilter);
    expect(rejectionsOf({ type: 'com.acme.ledger.month-closed' })).toEqual(notAFilter);
  });

  it('is refused without a type written out as text', () => {
    expect(rejectionsOf({ with: { source: '/ledger/eu' } })).toEqual([
      {
        pointer: `${at}/with/type`,
        detail: 'An event filter matched over the event alone names the type of the events it takes',
        forbidden: false,
      },
    ]);
    expect(rejectionsOf({ with: { type: '' } })).toEqual([
      { pointer: `${at}/with/type`, detail: 'type is text that is not empty', forbidden: false },
    ]);
    expect(rejectionsOf({ with: { type: 7 } })).toEqual([
      { pointer: `${at}/with/type`, detail: 'type is text that is not empty', forbidden: false },
    ]);
  });
});

describe('an event filter that tests what cannot be matched as it is', () => {
  it('is refused when its type, source or subject is an expression', () => {
    expect(
      rejectionsOf({ with: { type: '${ "com.acme" }', source: '${ .a }', subject: '${ $context.subject }' } }),
    ).toEqual(
      ['type', 'source', 'subject'].map((name) => ({
        pointer: `${at}/with/${name}`,
        detail: `${name} is written out, not computed by an expression, so that it is matched as it is`,
        forbidden: true,
      })),
    );
  });

  it('is refused when it tests an attribute other than type, source, subject and data', () => {
    expect(rejectionsOf({ with: { type: 'com.acme.ledger.month-closed', 'tenant/id': 'acme', id: 'm-1' } })).toEqual([
      {
        pointer: `${at}/with/tenant~1id`,
        detail: 'An event filter matched over the event alone tests type, source, subject and data, not tenant/id',
        forbidden: true,
      },
      {
        pointer: `${at}/with/id`,
        detail: 'An event filter matched over the event alone tests type, source, subject and data, not id',
        forbidden: true,
      },
    ]);
  });

  it('is refused as a listen filter is, for correlate and for an expression that does not compile', () => {
    const rejections = rejectionsOf({
      with: { type: 'com.acme.ledger.month-closed', data: '${ .[ }' },
      correlate: { region: { from: '${ .region }' } },
      until: true,
    });

    expect(rejections).toMatchObject([
      { pointer: `${at}/correlate`, detail: 'Correlating events is not supported in this version', forbidden: true },
      { pointer: `${at}/with/data`, forbidden: false },
      { pointer: `${at}/until`, detail: 'until is not part of an event filter, which takes with', forbidden: true },
    ]);
    expect(rejections[1]?.detail).toContain(' .[ ');
  });
});

function matchedIfRead(filter: LiteralFilter | undefined): FilterVerdict | undefined {
  return filter === undefined ? undefined : matchEvent(filter, monthClosed, now);
}

describe('a filter of a listen task that reaches events beyond its run', () => {
  it('is one whose type is written out, and none whose type is computed, missing or empty', () => {
    const filters: readonly Json[] = [
      { with: { type: 'com.acme.closed', source: '/ledger' } },
      { with: { type: '${ "com.acme.closed" }' } },
      { with: { source: '/ledger' } },
      { with: { type: '' } },
      'not a filter',
    ];

    expect(filters.map((filter) => brainWideFilterOf(filter))).toEqual([
      { type: 'com.acme.closed', source: '/ledger' },
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('is matched by its literal attributes and its closed expressions, leaving those that need the run’s variables', () => {
    const listener = listenerFilterOf(
      { type: 'com.acme.ledger.month-closed', subject: 'september', data: '${ .region == $context.region }' },
      '/do/0/await/listen/to/one',
    );
    const closed = listenerFilterOf({ type: 'com.acme.ledger.month-closed', data: '${ .region == "us" }' }, '/x');

    expect(listener).toEqual({
      reference: '/do/0/await/listen/to/one',
      type: 'com.acme.ledger.month-closed',
      attributes: { type: 'com.acme.ledger.month-closed', subject: 'september' },
      dataNeedsVariables: true,
    });
    expect([listener, closed].map((filter) => matchedIfRead(filter))).toEqual([true, false]);
    expect(listenerFilterOf({ type: '${ "x" }' }, '/x')).toBeUndefined();
  });
});

describe('the filters of a listen task that reach events beyond its run', () => {
  it('are those whose type is written out, of one, any or all, and none of a task that is no listen', () => {
    expect([
      listenFiltersOf({ listen: { to: { one: { with: { type: 'a' } } } } }),
      listenFiltersOf({ listen: { to: { all: [{ with: { type: 'a' } }, { with: { source: '/b' } }] } } }),
      listenFiltersOf({ set: {} }),
      listenFiltersOf(null),
    ]).toEqual([[{ type: 'a' }], [{ type: 'a' }], [], []]);
  });
});
