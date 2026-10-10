import { Option, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { factOf, recordedDecoder, strictRecordedDecoder } from '../index.ts';

const NoteSchema = Schema.Union([
  factOf('note_added', Schema.Struct({ text: Schema.String })),
  factOf('note_dropped', Schema.Struct({})),
]);

const decodeNote = recordedDecoder(NoteSchema);

const decodeNoteStrictly = strictRecordedDecoder(NoteSchema);

const context = { at: '2026-10-05T09:00:00.000Z', by: 'tester', runId: 'r-1' };

describe('decoding an event as it was recorded', () => {
  it('reads its type, its data and its context', () => {
    expect(decodeNote({ type: 'note_added', data: { text: 'hello' }, context, extra: true })).toEqual(
      Option.some({ type: 'note_added', data: { text: 'hello' }, context }),
    );
  });

  it('reads nothing of an event of another type, of data not its fact, or without a context', () => {
    expect([
      decodeNote({ type: 'note_burnt', data: {}, context }),
      decodeNote({ type: 'note_added', data: { text: 7 }, context }),
      decodeNote({ type: 'note_dropped', data: {} }),
      decodeNote('note_added'),
      decodeNote(null),
    ]).toEqual([Option.none(), Option.none(), Option.none(), Option.none(), Option.none()]);
  });
});

describe('decoding an event as it was recorded, by a reader that holds it to its schema', () => {
  it('reads its type, its data and its context, and fails on data that is not its fact', () => {
    expect(decodeNoteStrictly({ type: 'note_added', data: { text: 'hello' }, context })).toEqual({
      type: 'note_added',
      data: { text: 'hello' },
      context,
    });
    expect(() => decodeNoteStrictly({ type: 'note_added', data: { text: 7 }, context })).toThrow(/text/u);
  });
});
