import { ServedAsTool, makeDispatcher, messageIdOf, type Presenter } from '@beonauto/operations';
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineGetEvent } from '../index.ts';
import { brainFeed, presenterOf, toAlpha } from '../testing/brain-feed.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { toBrain } from '../testing/harness.ts';

const decodeText = Schema.decodeUnknownSync(Schema.Struct({ text: Schema.String }));

const calls: Presenter = {
  streamKind: 'calls',
  publicNames: { added: ['call_answered'] },
  present: ({ data }) => {
    const { text } = decodeText(data);
    return [{ type: 'call_answered', summary: 'A tool answered.', data: { text, result: text.repeat(70_000) } }];
  },
};

const steps: Presenter = {
  streamKind: 'run-logs',
  publicNames: { moved: ['run_moved', 'run_stepped'] },
  present: ({ data }) => {
    const { text } = decodeText(data);
    return [
      { type: 'run_moved', summary: 'A run moved.', data: { text } },
      { type: 'run_stepped', summary: 'A run stepped.', data: { text: `${text}1` }, part: { number: 1, causedBy: 0 } },
    ];
  },
};

const getEvent = defineGetEvent([presenterOf('notes', { added: 'note_added' }), calls, steps]);

const noteId = messageIdOf('brain/acme/alpha/notes', 1);

async function feedWithEvents() {
  const feed = brainFeed();
  await feed.recording('notes', 'added', 'a');
  await feed.recording('run-logs/r1', 'moved', 'x');
  await feed.recording('calls/c1', 'added', 'y');
  return feed;
}

describe('one event read whole', () => {
  it('is the event as a page shows it, by its id', async () => {
    const feed = await feedWithEvents();

    expect(await feed.callInBrain(getEvent, toAlpha(acmeAdmin, { event_id: noteId.toUpperCase() }))).toMatchObject({
      status: 'succeeded',
      output: {
        id: noteId,
        type: 'note_added',
        data: { text: 'a' },
        metadata: { stream: 'brain/acme/alpha/notes', position: 1, by: 'acme-admin' },
      },
    });
  });

  it("is a workflow's step by its record's id and its number, caused by its record", async () => {
    const feed = await feedWithEvents();
    const recordId = messageIdOf('brain/acme/alpha/run-logs/r1', 1);

    expect(await feed.callInBrain(getEvent, toAlpha(acmeAdmin, { event_id: `${recordId}/1` }))).toMatchObject({
      status: 'succeeded',
      output: { id: `${recordId}/1`, type: 'run_stepped', metadata: { causation_id: recordId } },
    });
  });

  it('holds every field whole over HTTP, and a result past 64 KiB as its size as a tool', async () => {
    const feed = await feedWithEvents();
    const request = toAlpha(acmeAdmin, { event_id: messageIdOf('brain/acme/alpha/calls/c1', 1) });
    const asTool = await feed.run(
      makeDispatcher([])
        .dispatchToBrain(getEvent.registration, request)
        .pipe(Effect.provideService(ServedAsTool, true)),
    );

    expect(await feed.callInBrain(getEvent, request)).toMatchObject({
      output: { data: { text: 'y', result: 'y'.repeat(70_000) } },
    });
    expect(asTool).toMatchObject({ output: { data: { text: 'y', result_bytes: 70_002 } } });
  });
});

describe('an event that cannot be read', () => {
  it('is not found when no event of the brain has the id, or the record has no such step', async () => {
    const feed = await feedWithEvents();
    const unknown = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';
    const ofAnotherBrain = toBrain('globex', 'gamma')(globexAdmin, { event_id: noteId });

    expect([
      await feed.callInBrain(getEvent, toAlpha(acmeAdmin, { event_id: unknown })),
      await feed.callInBrain(getEvent, toAlpha(acmeAdmin, { event_id: `${noteId}/1` })),
      await feed.callInBrain(getEvent, ofAnotherBrain),
    ]).toMatchObject([
      { status: 'rejected', reason: 'not_found', detail: `The brain holds no event ${unknown}` },
      { status: 'rejected', reason: 'not_found' },
      { status: 'rejected', reason: 'not_found' },
    ]);
  });

  it('is refused for an id that is not the id of an event', async () => {
    const feed = await feedWithEvents();

    expect(await feed.callInBrain(getEvent, toAlpha(acmeAdmin, { event_id: 'note-1' }))).toMatchObject({
      status: 'rejected',
      reason: 'invalid_input',
      issues: [{ pointer: '/event_id' }],
    });
  });
});

describe('the plain language of get_event', () => {
  it('names the event it reads, and says what it found', () => {
    const words = getEvent.registration.plainLanguage;

    expect([
      words?.attempt({ event_id: noteId }),
      words?.outcome(
        {
          id: noteId,
          type: 'note_added',
          summary: 'A note was added.',
          data: {},
          metadata: {
            stream: 'brain/acme/alpha/notes',
            position: 1,
            global_position: 1,
            correlation_id: null,
            causation_id: null,
            at: '2026-10-01T09:00:00.000Z',
            by: 'acme-admin',
          },
        },
        { event_id: noteId },
      ),
    ]).toEqual([`read the event ${noteId}`, 'Found the note_added event, whole: A note was added.']);
  });
});
