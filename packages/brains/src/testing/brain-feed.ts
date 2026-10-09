import type { Decider, Lineage, Outcome, Presenter, PublicEvent, RecordedEvent } from '@beonauto/operations';
import { memoryBrainRegistry } from '@beonauto/operations/testing';
import { Effect, Result, Schema } from 'effect';

import { defineListBrainEvents } from '../feed/list-brain-events.ts';
import { acmeAdmin } from './callers.ts';
import { harness, toBrain } from './harness.ts';

const FactSchema = Schema.Struct({
  type: Schema.Literals(['added', 'hidden', 'kept', 'moved']),
  text: Schema.String,
  at: Schema.String,
});

export type Fact = typeof FactSchema.Type;

const recorder: Decider<null, Fact, Fact> = {
  initialState: null,
  evolve: (state) => state,
  decide: (fact) => Result.succeed([fact]),
  eventSchema: FactSchema,
};

const decodeFact = Schema.decodeUnknownSync(FactSchema);

function eventOf({ id, cursor, causationId }: RecordedEvent, type: string, text: string, at: string): PublicEvent {
  return { id, cursor, causation_id: causationId, at, type, summary: 'Something happened.', data: { text } };
}

export function presenterOf(streamKind: string, publicNames: Readonly<Record<string, string | null>>): Presenter {
  return {
    streamKind,
    publicNames: Object.fromEntries(
      Object.entries(publicNames).map(([stored, name]: readonly [string, string | null]) => [
        stored,
        name === null ? [] : [name],
      ]),
    ),
    present: (recorded) => {
      const { text, at } = decodeFact(recorded.data);
      return [eventOf(recorded, String(publicNames[recorded.type]), text, at)];
    },
  };
}

const notes = presenterOf('notes', { added: 'note_added', hidden: null, kept: 'note_kept' });

const shelves = presenterOf('shelves', { added: 'shelf_filled' });

const steps: Presenter = {
  streamKind: 'run-logs',
  publicNames: { moved: ['run_moved', 'run_stepped'] },
  present: (recorded) => {
    const { text, at } = decodeFact(recorded.data);
    return [
      eventOf(recorded, 'run_moved', text, at),
      ...[1, 2].map((step) => eventOf(recorded, 'run_stepped', `${text}${step}`, at)),
    ];
  },
};

export const listBrainEvents = defineListBrainEvents([notes, shelves, steps]);

const brains = memoryBrainRegistry(
  [
    { org: 'acme', brain: 'alpha' },
    { org: 'globex', brain: 'gamma' },
  ],
  [{ org: 'acme', brain: 'old' }],
);

export const toAlpha = toBrain('acme', 'alpha');

const TextsSchema = Schema.Struct({
  output: Schema.Struct({
    events: Schema.Array(Schema.Struct({ data: Schema.Struct({ text: Schema.String }) })),
    has_more: Schema.Boolean,
    next_cursor: Schema.NullOr(Schema.String),
  }),
});

export const textsOf = Schema.decodeUnknownSync(TextsSchema);

export function textsIn(outcome: Outcome): readonly string[] {
  return textsOf(outcome).output.events.map(({ data }) => data.text);
}

export function withCursor(cursor: string | undefined): object {
  return cursor === undefined ? {} : { cursor };
}

export function brainFeed() {
  const feed = harness(brains);
  let minute = 0;
  const recordingWith = (stream: string, fact: Omit<Fact, 'at'>, lineage?: Lineage, brain = 'brain/acme/alpha') => {
    minute += 1;
    const at = `2026-10-01T09:${String(minute).padStart(2, '0')}:00.000Z`;
    return feed.run(
      Effect.orDie(feed.ledger.service.execute(`${brain}/${stream}`, recorder, { ...fact, at }, lineage)),
      at,
    );
  };
  const recording = (stream: string, type: Fact['type'], text: string, brain = 'brain/acme/alpha') =>
    recordingWith(stream, { type, text }, undefined, brain);
  const reading = (input: object = {}) => feed.callInBrain(listBrainEvents, toAlpha(acmeAdmin, input));
  return { ...feed, recording, recordingWith, reading };
}

export async function brainWithEvents() {
  const feed = brainFeed();
  await feed.recording('notes', 'added', 'a');
  await feed.recording('shelves/red', 'added', 'b');
  await feed.recording('notes', 'hidden', 'c');
  await feed.recording('secrets', 'added', 'd');
  await feed.recording('notes', 'kept', 'e');
  return feed;
}

export async function everyText(
  read: (cursor: string | undefined) => Promise<Outcome>,
  between: () => Promise<unknown>,
  cursor?: string,
): Promise<readonly string[]> {
  const page = await read(cursor);
  await between();
  const { next_cursor: next } = textsOf(page).output;
  return [...textsIn(page), ...(next === null ? [] : await everyText(read, between, next))];
}
