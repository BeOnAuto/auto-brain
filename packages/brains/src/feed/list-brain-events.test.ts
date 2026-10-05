import type { Decider, Outcome, Presenter } from '@beonauto/operations';
import { memoryBrainRegistry } from '@beonauto/operations/testing';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineListBrainEvents } from '../index.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { asQueryString, harness, toBrain } from '../testing/harness.ts';

const FactSchema = Schema.Struct({
  type: Schema.Literals(['added', 'hidden', 'kept']),
  text: Schema.String,
  at: Schema.String,
});

type Fact = typeof FactSchema.Type;

const recorder: Decider<null, Fact, Fact> = {
  initialState: null,
  evolve: (state) => state,
  decide: (fact) => Result.succeed([fact]),
  eventSchema: FactSchema,
};

const decodeFact = Schema.decodeUnknownSync(FactSchema);

function presenterOf(streamKind: string, publicNames: Readonly<Record<string, string | null>>): Presenter {
  return {
    streamKind,
    publicNames,
    present: ({ id, type, data }) => {
      const { text, at } = decodeFact(data);
      return { id, at, type: String(publicNames[type]), summary: 'Something happened.', data: { text } };
    },
  };
}

const notes = presenterOf('notes', { added: 'note_added', hidden: null, kept: 'note_kept' });

const shelves = presenterOf('shelves', { added: 'shelf_filled' });

const listBrainEvents = defineListBrainEvents([notes, shelves]);

const brains = memoryBrainRegistry(
  [
    { org: 'acme', brain: 'alpha' },
    { org: 'globex', brain: 'gamma' },
  ],
  [{ org: 'acme', brain: 'old' }],
);

const toAlpha = toBrain('acme', 'alpha');

const TextsSchema = Schema.Struct({
  output: Schema.Struct({
    events: Schema.Array(Schema.Struct({ data: Schema.Struct({ text: Schema.String }) })),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
});

const textsOf = Schema.decodeUnknownSync(TextsSchema);

function textsIn(outcome: Outcome): readonly string[] {
  return textsOf(outcome).output.events.map(({ data }) => data.text);
}

function withCursor(cursor: string | undefined): object {
  return cursor === undefined ? {} : { cursor };
}

function brainFeed() {
  const feed = harness(brains);
  let minute = 0;
  const recording = (stream: string, type: Fact['type'], text: string, brain = 'brain/acme/alpha') => {
    minute += 1;
    const at = `2026-10-01T09:${String(minute).padStart(2, '0')}:00.000Z`;
    return feed.run(Effect.orDie(feed.ledger.service.execute(`${brain}/${stream}`, recorder, { type, text, at })), at);
  };
  const reading = (input: object = {}) => feed.callInBrain(listBrainEvents, toAlpha(acmeAdmin, input));
  return { ...feed, recording, reading };
}

async function brainWithEvents() {
  const feed = brainFeed();
  await feed.recording('notes', 'added', 'a');
  await feed.recording('shelves/red', 'added', 'b');
  await feed.recording('notes', 'hidden', 'c');
  await feed.recording('secrets', 'added', 'd');
  await feed.recording('notes', 'kept', 'e');
  return feed;
}

async function everyText(
  read: (cursor: string | undefined) => Promise<Outcome>,
  between: () => Promise<unknown>,
  cursor?: string,
): Promise<readonly string[]> {
  const page = await read(cursor);
  await between();
  const { next_cursor: next } = textsOf(page).output;
  return [...textsIn(page), ...(next === null ? [] : await everyText(read, between, next))];
}

describe('list_brain_events', () => {
  it('is a brain query at GET /events whose type names the public types of its presenters', () => {
    expect(listBrainEvents.registration).toMatchObject({
      scope: 'brain',
      kind: 'query',
      title: 'List brain events',
      route: { method: 'GET', path: '/events' },
      reasons: ['invalid_input'],
      input: { schema: { properties: { type: { enum: ['note_added', 'note_kept', 'shelf_filled'] } } } },
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
