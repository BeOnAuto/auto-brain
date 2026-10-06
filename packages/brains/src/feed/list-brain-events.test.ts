import { describe, expect, it } from 'vitest';

import { defineListBrainEvents } from '../index.ts';
import {
  brainFeed,
  brainWithEvents,
  everyText,
  listBrainEvents,
  presenterOf,
  textsIn,
  textsOf,
  toAlpha,
  withCursor,
} from '../testing/brain-feed.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { asQueryString, toBrain } from '../testing/harness.ts';

describe('list_brain_events', () => {
  it('is a brain query at GET /events whose type names the public types of its presenters', () => {
    expect(listBrainEvents.registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      title: 'List brain events',
      route: { method: 'GET', path: '/events' },
      reasons: ['invalid_input'],
      input: {
        schema: {
          properties: { type: { enum: ['note_added', 'note_kept', 'shelf_filled', 'run_moved', 'run_stepped'] } },
        },
      },
    });
    expect(listBrainEvents.registration.description).toContain(
      "The brain's own creation, update and retirement are not among the events",
    );
  });

  it('needs a presenter that shows at least one type of event', () => {
    expect(() => defineListBrainEvents([presenterOf('notes', { added: null })])).toThrow(
      'The events of a brain need a presenter that shows at least one type of event',
    );
  });

  it('reads what the brain recorded newest first, hiding what no presenter shows', async () => {
    const { reading } = await brainWithEvents();

    expect(textsIn(await reading())).toEqual(['e', 'b', 'a']);
    expect(await reading({ limit: 1 })).toMatchObject({
      status: 'succeeded',
      output: {
        events: [
          { at: '2026-10-01T09:05:00.000Z', type: 'note_kept', summary: 'Something happened.', data: { text: 'e' } },
        ],
        has_more: true,
      },
    });
  });

  it('reads oldest first, and from a query string', async () => {
    const { callInBrain } = await brainWithEvents();

    expect(
      textsIn(await callInBrain(listBrainEvents, asQueryString(toAlpha(acmeAdmin, { order: 'asc', limit: '5' })))),
    ).toEqual(['a', 'b', 'e']);
  });
});

describe('the events of a brain of one type', () => {
  it('are those its presenter shows under that name, though another kind stores the same type', async () => {
    const { reading } = await brainWithEvents();

    expect([
      textsIn(await reading({ type: 'note_added' })),
      textsIn(await reading({ type: 'shelf_filled' })),
      textsIn(await reading({ type: 'note_kept' })),
    ]).toEqual([['a'], ['b'], ['e']]);
  });

  it('are looked for beyond the limit of a page, up to a thousand records', async () => {
    const { reading } = await brainWithEvents();

    expect(textsOf(await reading({ type: 'note_kept', order: 'asc', limit: 1 })).output).toEqual({
      events: [{ data: { text: 'e' } }],
      has_more: false,
      next_cursor: null,
    });
  });

  it('leave a page they empty with a cursor', async () => {
    const { reading } = await brainWithEvents();

    expect(textsOf(await reading({ type: 'note_added', limit: 2 })).output).toMatchObject({
      events: [],
      has_more: true,
    });
  });

  it('are refused for a type no presenter shows', async () => {
    const { reading } = await brainWithEvents();

    expect(await reading({ type: 'added' })).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/type' }],
    });
  });
});

describe('the events of a brain since a time', () => {
  it('are those it recorded from then on, in either order', async () => {
    const { reading } = await brainWithEvents();

    expect([
      textsIn(await reading({ since: '2026-10-01T09:03:00Z' })),
      textsIn(await reading({ since: '2026-10-01T09:02:00Z', order: 'asc' })),
    ]).toEqual([['e'], ['b', 'e']]);
  });
});

describe('paging through the events of a brain', () => {
  it('delivers every event once in either order while the brain records more', async () => {
    const newest = await brainWithEvents();
    const oldest = await brainWithEvents();

    const newestFirst = await everyText(
      (cursor) => newest.reading({ limit: 1, ...withCursor(cursor) }),
      () => newest.recording('notes', 'added', 'more'),
    );
    const oldestFirst = await everyText(
      (cursor) => oldest.reading({ order: 'asc', limit: 2, ...withCursor(cursor) }),
      () => oldest.recording('notes', 'added', 'more'),
    );

    expect(newestFirst).toEqual(['e', 'b', 'a']);
    expect(oldestFirst).toEqual(['a', 'b', 'e', 'more', 'more', 'more']);
  });

  it('refuses a cursor that does not decode or that another brain gave', async () => {
    const { callInBrain, reading, recording } = await brainWithEvents();
    await recording('notes', 'added', 'x', 'brain/globex/gamma');
    await recording('notes', 'added', 'y', 'brain/globex/gamma');
    const ofGamma = textsOf(await callInBrain(listBrainEvents, toBrain('globex', 'gamma')(globexAdmin, { limit: 1 })));

    expect([
      await reading({ cursor: 'not-a-cursor' }),
      await reading({ cursor: String(ofGamma.output.next_cursor) }),
    ]).toMatchObject([
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/cursor' }] },
      { status: 'rejected', reason: 'invalid_input', issues: [{ pointer: '/cursor' }] },
    ]);
  });
});

describe('the events of a retired brain', () => {
  it('stay readable', async () => {
    const { callInBrain, recording } = brainFeed();
    await recording('notes', 'added', 'kept for good', 'brain/acme/old');

    expect(textsIn(await callInBrain(listBrainEvents, toBrain('acme', 'old')(acmeAdmin)))).toEqual(['kept for good']);
  });
});
