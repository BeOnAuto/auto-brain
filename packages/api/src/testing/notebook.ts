import {
  BrainIdSchema,
  BrainReader,
  BrainWriter,
  Conflict,
  NotFound,
  OrgReader,
  OrgWriter,
  defineCommand,
  defineQuery,
  type Decider,
} from '@beonauto/operations';
import { Effect, Result, Schema } from 'effect';

const NoteName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u));

const NoteSchema = Schema.Struct({ name: NoteName, text: Schema.String });

type Note = typeof NoteSchema.Type;

const Nothing = Schema.Record(Schema.String, Schema.Never);

const notebook: Decider<readonly Note[], Note, Note, 'conflict'> = {
  initialState: [],
  evolve: (notes, added) => [...notes, added],
  decide: (note, notes) =>
    notes.some(({ name }) => name === note.name)
      ? Result.fail(new Conflict({ detail: `A note named ${note.name} exists` }))
      : Result.succeed([note]),
  eventSchema: NoteSchema,
};

export const addNote = defineCommand('brain', {
  name: 'add_note',
  title: 'Add note',
  description: 'Adds a note to the brain.',
  route: { method: 'POST', path: '/notes' },
  successStatus: 201,
  inputSchema: NoteSchema,
  outputSchema: NoteSchema,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* (note) {
    yield* (yield* BrainWriter).execute('notes', notebook, note);
    return note;
  }),
});

const listNotes = defineQuery('brain', {
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

export const latestNote = defineQuery('brain', {
  name: 'latest_note',
  title: 'Latest note',
  description: 'Reads the note added last.',
  route: { method: 'GET', path: '/notes/latest' },
  inputSchema: Nothing,
  outputSchema: NoteSchema,
  reasons: ['not_found'],
  handle: Effect.fnUntraced(function* () {
    const { state } = yield* (yield* BrainReader).load('notes', notebook);
    const latest = state.at(-1);
    if (latest === undefined) {
      return yield* new NotFound({ detail: 'The brain has no notes' });
    }
    return latest;
  }),
});

const breakDown = defineQuery('brain', {
  name: 'break_down',
  title: 'Break down',
  description: 'Fails with a defect.',
  route: { method: 'GET', path: '/broken' },
  inputSchema: Nothing,
  outputSchema: Nothing,
  reasons: [],
  handle: () => Effect.die(new Error('database password is hunter2')),
});

const waitForever = defineQuery('brain', {
  name: 'wait_forever',
  title: 'Wait forever',
  description: 'Never finishes on its own.',
  route: { method: 'GET', path: '/waiting' },
  inputSchema: Nothing,
  outputSchema: Nothing,
  reasons: [],
  handle: () => Effect.never,
});

const BrainLabelSchema = Schema.Struct({ brain: BrainIdSchema, label: Schema.String });

type BrainLabel = typeof BrainLabelSchema.Type;

const labelBook: Decider<readonly BrainLabel[], BrainLabel, BrainLabel> = {
  initialState: [],
  evolve: (labels, labelled) => [...labels.filter(({ brain }) => brain !== labelled.brain), labelled],
  decide: (labelled) => Result.succeed([labelled]),
  eventSchema: BrainLabelSchema,
};

const labelBrain = defineCommand('org', {
  name: 'label_brain',
  title: 'Label brain',
  description: 'Gives a brain of the org a label.',
  route: { method: 'PUT', path: '/brains/{brain}/label' },
  inputSchema: BrainLabelSchema,
  outputSchema: BrainLabelSchema,
  reasons: ['conflict'],
  handle: Effect.fnUntraced(function* (labelled) {
    yield* (yield* OrgWriter).execute('brain-labels', labelBook, labelled);
    return labelled;
  }),
});

const listLabels = defineQuery('org', {
  name: 'list_labels',
  title: 'List labels',
  description: 'Lists the labels of the brains of the org.',
  route: { method: 'GET', path: '/brain-labels' },
  inputSchema: Nothing,
  outputSchema: Schema.Struct({ labels: Schema.Array(BrainLabelSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* () {
    const { state } = yield* (yield* OrgReader).load('brain-labels', labelBook);
    return { labels: state };
  }),
});

export const notebookOperations = [
  addNote,
  listNotes,
  getNote,
  latestNote,
  breakDown,
  waitForever,
  labelBrain,
  listLabels,
];
