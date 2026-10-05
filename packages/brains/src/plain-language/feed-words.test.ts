import type { Presenter } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { defineListBrainEvents } from '../index.ts';

const notes: Presenter = {
  streamKind: 'notes',
  publicNames: { added: 'note_added' },
  present: () => null,
};

const { plainLanguage } = defineListBrainEvents([notes]).registration;

const event = {
  id: 'WyJicmFpbiJd',
  at: '2026-10-01T09:00:00.000Z',
  type: 'note_added',
  summary: 'A note was added.',
  data: {},
};

function found(events: readonly unknown[], request: object = {}, hasMore = false): string | undefined {
  return plainLanguage?.outcome({ events, has_more: hasMore, next_cursor: hasMore ? 'WyJicmFpbiJd' : null }, request);
}

describe('the plain language of list_brain_events', () => {
  it('says how many events it found, of what kind, since when and in which order', () => {
    expect([
      found([event, event]),
      found([event], { type: 'note_added', since: '2026-10-01T09:00:00Z', order: 'asc' }, true),
      found(Array.from({ length: 100 }, () => event)),
    ]).toEqual([
      'Found 2 events in this brain, newest first.',
      'Found 1 event of the kind asked for in this brain since the time given, oldest first. More remain after these.',
      'Found one hundred events in this brain, newest first.',
    ]);
  });

  it('says when nothing has happened, nothing more, or nothing on this page', () => {
    expect([
      found([]),
      found([], { since: '2026-10-01T09:00:00Z' }),
      found([], { type: 'note_added', cursor: 'WyJicmFpbiJd' }),
      found([], { type: 'note_added' }, true),
    ]).toEqual([
      'Nothing has happened in this brain yet.',
      'Nothing has happened in this brain since the time given.',
      'There is nothing more of the kind asked for to read in this brain.',
      'This page shows nothing of the kind asked for, but there is more of this brain to read.',
    ]);
  });

  it('says what it tried', () => {
    expect([plainLanguage?.attempt({}), plainLanguage?.attempt({ type: 7 })]).toEqual([
      'read what happened in the brain',
      'read what happened in the brain',
    ]);
  });
});
