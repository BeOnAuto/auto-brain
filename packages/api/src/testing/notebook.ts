import {
  BrainIdSchema,
  BrainReader,
  BrainWriter,
  Conflict,
  InvalidInput,
  NotFound,
  OrgReader,
  OrgWriter,
  Unavailable,
  UnavailableKindSchema,
  defineCommand,
  defineQuery,
  quoted,
  type Decider,
  type Issue,
  type PlainLanguage,
} from '@beonauto/operations';
import { Effect, Result, Schema } from 'effect';

const NoteName = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,31}$/u));

const NoteSchema = Schema.Struct({ name: NoteName, text: Schema.String });

type Note = typeof NoteSchema.Type;

const Nothing = Schema.Record(Schema.String, Schema.Never);

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

function plainly(task: string): PlainLanguage<unknown, unknown> {
  return { task, attempt: () => task, outcome: () => `Done: ${task}.` };
}

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
  plainLanguage: {
    task: 'add a note',
    attempt: ({ name }) => `add the note ${quoted(name)}`,
    outcome: ({ name }) => `Added the note ${quoted(name)}.`,
  },
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
  plainLanguage: plainly('list the notes'),
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
  plainLanguage: {
    task: 'read a note',
    attempt: ({ name }) => `read the note ${quoted(name)}`,
    outcome: ({ name, text }) => `The note ${quoted(name)} says ${quoted(text)}.`,
  },
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
  plainLanguage: plainly('read the latest note'),
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
  plainLanguage: plainly('break down'),
});

export const waitForever = defineQuery('brain', {
  name: 'wait_forever',
  title: 'Wait forever',
  description: 'Never finishes on its own.',
  route: { method: 'GET', path: '/waiting' },
  inputSchema: Nothing,
  outputSchema: Nothing,
  reasons: [],
  handle: () => Effect.never,
  plainLanguage: plainly('wait forever'),
});

const BrainLabelSchema = Schema.Struct({ brain: BrainIdSchema, label: Schema.String });

type BrainLabel = typeof BrainLabelSchema.Type;

const BrainLabelledSchema = Schema.Struct({ type: Schema.Literal('brain_labelled'), labelled: BrainLabelSchema });

type BrainLabelled = typeof BrainLabelledSchema.Type;

const labelBook: Decider<readonly BrainLabel[], BrainLabel, BrainLabelled> = {
  initialState: [],
  evolve: (labels, { labelled }) => [...labels.filter(({ brain }) => brain !== labelled.brain), labelled],
  decide: (labelled) => Result.succeed([{ type: 'brain_labelled', labelled }]),
  eventSchema: BrainLabelledSchema,
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
  plainLanguage: plainly('label a brain'),
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
  plainLanguage: plainly('list the labels'),
});

const checkLines = defineCommand('brain', {
  name: 'check_lines',
  title: 'Check lines',
  description: 'Accepts lines that all start with a capital letter, and rejects every other line.',
  route: { method: 'POST', path: '/lines' },
  inputSchema: Schema.Struct({ lines: Schema.Array(Schema.String) }),
  outputSchema: Schema.Struct({ accepted: Schema.Int }),
  reasons: ['invalid_input'],
  handle: ({ lines }) => {
    const issues = lines.flatMap((line, index): readonly Issue[] =>
      /^[A-Z]/u.test(line)
        ? []
        : [{ detail: `Line ${index + 1} must start with a capital letter`, pointer: `/lines/${index}` }],
    );
    return issues.length === 0
      ? Effect.succeed({ accepted: lines.length })
      : Effect.fail(new InvalidInput({ detail: 'Some lines need fixing', issues }));
  },
  plainLanguage: plainly('check the lines'),
});

const becauseOfKind = {
  model_not_offered: 'model_not_allowed',
  tool_not_offered: 'tool_not_listed',
  mcp_server_failed: 'unreachable',
  tools_unfinished: 'model_unavailable',
} as const;

const sendNotes = defineCommand('brain', {
  name: 'send_notes',
  title: 'Send notes',
  description: 'Sends the notes nowhere, and says why it could not, by the kind it is given.',
  route: { method: 'POST', path: '/notes/sending' },
  inputSchema: Schema.Struct({ kind: UnavailableKindSchema }),
  outputSchema: Nothing,
  reasons: ['unavailable'],
  handle: ({ kind }) =>
    Effect.fail(new Unavailable({ detail: 'The notes could not be sent', kind, because: becauseOfKind[kind] })),
  plainLanguage: plainly('send the notes'),
});

export const notebookOperations = [
  addNote,
  checkLines,
  listNotes,
  getNote,
  latestNote,
  breakDown,
  waitForever,
  labelBrain,
  listLabels,
  sendNotes,
];
