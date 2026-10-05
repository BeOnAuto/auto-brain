import { Effect, Result, Schema } from 'effect';

import { BrainReader, BrainWriter, Conflict, NotFound, defineCommand, defineQuery, type Decider } from '../index.ts';

const NoteName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u));

const noteFields = { name: NoteName, text: Schema.String };

const NoteSchema = Schema.Struct(noteFields).annotate({ identifier: 'Note' });

type Note = typeof NoteSchema.Type;

const NoteAddedSchema = Schema.Struct({ type: Schema.Literal('note_added'), note: NoteSchema });

type NoteAdded = typeof NoteAddedSchema.Type;

const notebook: Decider<readonly Note[], Note, NoteAdded, 'conflict'> = {
  initialState: [],
  evolve: (notes, { note }) => [...notes, note],
  decide: (note, notes) =>
    notes.some(({ name }) => name === note.name)
      ? Result.fail(new Conflict({ detail: `A note named ${note.name} exists` }))
      : Result.succeed([{ type: 'note_added', note }]),
  eventSchema: NoteAddedSchema,
};

const Added = Schema.Struct({ added: NoteSchema, version: Schema.Int });

export const addNote = defineCommand('brain', {
  name: 'add_note',
  title: 'Add note',
  description: 'Adds a note to the brain.',
  route: { method: 'POST', path: '/notes' },
  successStatus: 201,
  inputSchema: Schema.Struct(noteFields),
  outputSchema: Added,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* (note) {
    const { version } = yield* (yield* BrainWriter).execute('notes', notebook, note);
    return { added: note, version };
  }),
});

export const listNotes = defineQuery('brain', {
  name: 'list_notes',
  title: 'List notes',
  description: 'Lists the notes of the brain.',
  route: { method: 'GET', path: '/notes' },
  inputSchema: Schema.Struct({
    limit: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
  }),
  outputSchema: Schema.Struct({ notes: Schema.Array(NoteSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ limit }) {
    const { state } = yield* (yield* BrainReader).load('notes', notebook);
    return { notes: state.slice(0, limit) };
  }),
});

export const getNote = defineQuery('brain', {
  name: 'get_note',
  title: 'Get note',
  description: 'Reads one note of the brain.',
  route: { method: 'GET', path: '/notes/{name}' },
  inputSchema: Schema.Struct({ name: NoteName }),
  outputSchema: NoteSchema,
  reasons: ['not_found'],
  handle: Effect.fnUntraced(function* ({ name }) {
    const { state } = yield* (yield* BrainReader).load('notes', notebook);
    const found = state.find((note) => note.name === name);
    if (found === undefined) {
      return yield* new NotFound({ detail: `There is no note ${name}` });
    }
    return found;
  }),
});

export const copyNote = defineCommand('brain', {
  name: 'copy_note',
  title: 'Copy note',
  description: 'Adds a note with the text of another note.',
  route: { method: 'POST', path: '/notes/{name}/copies' },
  successStatus: 201,
  inputSchema: Schema.Struct({ name: NoteName, copy: NoteName }),
  outputSchema: Added,
  reasons: ['not_found', 'conflict'],
  handle: Effect.fnUntraced(function* ({ name, copy }) {
    const { text } = yield* getNote.call({ name });
    return yield* addNote.call({ name: copy, text });
  }),
});

export const readNoteHistory = defineQuery('brain', {
  name: 'read_note_history',
  title: 'Read note history',
  description: 'Reads one page of what the brain recorded, oldest first, taking any limit and time it is given.',
  route: { method: 'GET', path: '/note-history' },
  inputSchema: Schema.Struct({
    limit: Schema.Int,
    cursor: Schema.optionalKey(Schema.String),
    since: Schema.optionalKey(Schema.String),
    execution: Schema.optionalKey(Schema.String),
  }),
  outputSchema: Schema.Struct({
    streams: Schema.Array(Schema.String),
    ids: Schema.Array(Schema.String),
    next_cursor: Schema.NullOr(Schema.String),
  }),
  reasons: ['invalid_input'],
  handle: Effect.fnUntraced(function* ({ limit, cursor, since, execution }) {
    const { records, nextCursor } = yield* (yield* BrainReader).readRecorded(
      execution === undefined ? { kind: 'everything' } : { kind: 'run', execution },
      { order: 'asc', limit, ...(cursor === undefined ? {} : { cursor }), ...(since === undefined ? {} : { since }) },
    );
    return { streams: records.map(({ stream }) => stream), ids: records.map(({ id }) => id), next_cursor: nextCursor };
  }),
});
