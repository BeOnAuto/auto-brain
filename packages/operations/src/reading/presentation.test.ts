import { describe, expect, it } from 'vitest';

import { presentationOf, streamKindOf, type Presenter, type PublicEvent, type RecordedEvent } from '../index.ts';

function recorded(stream: string, type: string): RecordedEvent {
  return {
    id: `${stream}:${type}`,
    cursor: `${stream}@${type}`,
    causationId: null,
    correlationId: null,
    stream,
    version: 1,
    globalPosition: 1,
    type,
    data: {},
    context: { at: '2026-10-05T09:00:00.000Z', by: 'tester' },
    recordedAt: '2026-10-05T09:00:00.000Z',
  };
}

function shown({ id, cursor, type }: RecordedEvent): PublicEvent {
  return {
    id,
    cursor,
    causation_id: null,
    at: '2026-10-05T09:00:00.000Z',
    type: `shown_${type}`,
    summary: 'Something happened.',
    data: {},
  };
}

const notes: Presenter = {
  streamKind: 'notes',
  publicNames: { note_added: ['shown_note_added'], note_dropped: [], note_kept: ['shown_note_kept'] },
  present: (record) => [shown(record)],
};

const shelves: Presenter = {
  streamKind: 'shelves',
  publicNames: { shelf_filled: ['shown_shelf_filled', 'shown_shelf_counted'], note_added: ['shown_note_added'] },
  present: (record) => (record.stream.endsWith('/secret') ? [] : [shown(record)]),
};

const presentation = presentationOf([notes, shelves]);

describe('the kind of a stream', () => {
  it.each([
    ['runs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', 'runs'],
    ['definitions/reasoning', 'definitions'],
    ['notes', 'notes'],
  ])('of %s is %s', (stream, kind) => {
    expect(streamKindOf(stream)).toBe(kind);
  });
});

describe('the presentation of what a brain recorded', () => {
  it('presents a record by the presenter of its stream kind', () => {
    expect(presentation.present(recorded('notes', 'note_added'))).toEqual([shown(recorded('notes', 'note_added'))]);
    expect(presentation.present(recorded('shelves/red', 'shelf_filled'))).toEqual([
      shown(recorded('shelves/red', 'shelf_filled')),
    ]);
  });

  it('hides a record of a kind without a presenter, of a type its presenter hides or does not know, or one its presenter hides', () => {
    expect(
      [
        recorded('run-logs/0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a', 'input_applied'),
        recorded('notes', 'note_dropped'),
        recorded('notes', 'note_burnt'),
        recorded('notes', 'constructor'),
        recorded('shelves/secret', 'shelf_filled'),
      ].map((record) => presentation.present(record)),
    ).toEqual([[], [], [], [], []]);
  });

  it('names every public type once, and the stored types each stands for', () => {
    expect(presentation.publicTypes).toEqual([
      'shown_note_added',
      'shown_note_kept',
      'shown_shelf_filled',
      'shown_shelf_counted',
    ]);
    expect(presentation.storedTypesOf('shown_note_added')).toEqual(['note_added']);
    expect(presentation.storedTypesOf('shown_shelf_filled')).toEqual(['shelf_filled']);
    expect(presentation.storedTypesOf('shown_shelf_counted')).toEqual(['shelf_filled']);
    expect(presentation.storedTypesOf('note_dropped')).toEqual([]);
  });

  it('refuses two presenters of one stream kind', () => {
    expect(() => presentationOf([notes, { ...shelves, streamKind: 'notes' }])).toThrow(
      new Error('More than one presenter presents the stream kind notes'),
    );
  });
});
