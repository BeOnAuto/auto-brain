import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { BrainReader, BrainWriter, NotFound, defineQuery } from '../index.ts';
import { labelBrain } from '../testing/brain-labels.ts';
import { memoryLedger } from '../testing/memory-ledger.ts';
import { misreport, overshare } from '../testing/misbehaving.ts';
import { addNote, getNote } from '../testing/notes.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

const about = {
  title: 'Probe',
  description: 'Probes the definer.',
  inputSchema: Empty,
  outputSchema: Empty,
  reasons: [],
  handle: () => Effect.succeed({}),
};

const measure = defineQuery('brain', {
  name: 'measure',
  title: 'Measure',
  description: 'Computes the area of a circle or a square.',
  route: { method: 'GET', path: '/measure' },
  inputSchema: Schema.Union([
    Schema.Struct({ shape: Schema.Literal('circle'), radius: Schema.Finite }),
    Schema.Struct({ shape: Schema.Literal('square'), side: Schema.Finite }),
  ]),
  outputSchema: Schema.Struct({ area: Schema.Finite }),
  reasons: [],
  handle: (input) => Effect.succeed({ area: input.shape === 'circle' ? Math.PI * input.radius ** 2 : input.side ** 2 }),
});

function schemaDefectOf<A, E, R>(call: Effect.Effect<A, E, R>): Effect.Effect<boolean, E, R> {
  return call.pipe(
    Effect.as(false),
    Effect.catchDefect((defect) => Effect.succeed(Schema.isSchemaError(defect))),
  );
}

const noteJsonSchema = {
  type: 'object',
  properties: { name: { type: 'string', pattern: '^[a-z][a-z0-9-]{0,31}$' }, text: { type: 'string' } },
  required: ['name', 'text'],
  additionalProperties: false,
};

describe('a registration', () => {
  it('describes a command with its route, success status, reasons and schemas', () => {
    expect(addNote.registration).toMatchObject({
      scope: 'brain',
      kind: 'command',
      name: 'add_note',
      title: 'Add note',
      description: 'Adds a note to the brain.',
      route: { method: 'POST', path: '/notes' },
      pathParameters: [],
      successStatus: 201,
      reasons: ['conflict'],
    });
    expect(addNote.registration.input).toEqual({ schema: noteJsonSchema, definitions: {} });
  });

  it('keeps named definitions apart so a transport can hoist them', () => {
    expect(getNote.registration.output).toEqual({
      schema: { type: 'object', $ref: '#/$defs/Note' },
      definitions: { Note: noteJsonSchema },
    });
    expect(addNote.registration.output.definitions).toEqual({ Note: noteJsonSchema });
  });

  it('answers with 200 unless the definition says otherwise, and names its path parameters', () => {
    expect(getNote.registration).toMatchObject({ successStatus: 200, pathParameters: ['name'] });
    expect(labelBrain.registration).toMatchObject({ scope: 'org', successStatus: 200, pathParameters: ['brain'] });
  });

  it('exports a union input as one object schema with a branch per member', () => {
    expect(measure.registration.input.schema).toEqual({
      type: 'object',
      anyOf: [
        {
          type: 'object',
          properties: { shape: { type: 'string', enum: ['circle'] }, radius: { type: 'number' } },
          required: ['shape', 'radius'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { shape: { type: 'string', enum: ['square'] }, side: { type: 'number' } },
          required: ['shape', 'side'],
          additionalProperties: false,
        },
      ],
    });
  });
});

describe('a definition', () => {
  it.each(['Probe', 'probe-name', '', '1probe', `p${'r'.repeat(64)}`])('may not be named %j', (name) => {
    expect(() => defineQuery('org', { ...about, name, route: { method: 'GET', path: '/probe' } })).toThrow(
      `The operation name ${name} is malformed`,
    );
  });

  const malformedPaths: ReadonlyArray<`/${string}`> = [
    '/',
    '/Probe',
    '/a//b',
    '/a/',
    '/{}',
    '/{1a}',
    '/a b',
    '/{a}/{a}',
  ];

  it.each(malformedPaths)('may not have the route path %j', (path) => {
    expect(() => defineQuery('org', { ...about, name: 'probe', route: { method: 'GET', path } })).toThrow(
      `The route path ${path} is malformed`,
    );
  });
});

describe('the typed call', () => {
  const ledger = memoryLedger();
  const withNotes = <A, E>(call: Effect.Effect<A, E, BrainReader | BrainWriter>) =>
    call.pipe(Effect.provideService(BrainReader, ledger.service), Effect.provideService(BrainWriter, ledger.service));

  it('runs the handler with typed input and output in the services it is given', async () => {
    const read = await Effect.runPromise(
      withNotes(
        Effect.gen(function* () {
          yield* addNote.call({ name: 'anvil', text: 'heavy' });
          return yield* getNote.call({ name: 'anvil' });
        }),
      ),
    );

    expect(read).toEqual({ name: 'anvil', text: 'heavy' });
    expect(ledger.streamNames()).toEqual(['notes']);
  });

  it('fails with the refusal the handler declares', async () => {
    const refusal = await Effect.runPromise(withNotes(Effect.flip(getNote.call({ name: 'missing' }))));

    expect(refusal).toEqual(new NotFound({ detail: 'There is no note missing' }));
  });

  it('decodes a union input by its members', async () => {
    expect(await Effect.runPromise(measure.call({ shape: 'square', side: 3 }))).toEqual({ area: 9 });
    expect(await Effect.runPromise(measure.call({ shape: 'circle', radius: 1 }))).toEqual({ area: Math.PI });
  });

  it('treats input that breaks the input schema as a defect of the calling code', async () => {
    expect(await Effect.runPromise(withNotes(schemaDefectOf(getNote.call({ name: 'Not A Name' }))))).toBe(true);
  });

  it('treats output that breaks the output schema as a defect', async () => {
    expect(await Effect.runPromise(schemaDefectOf(misreport.call({})))).toBe(true);
  });

  it('treats a field the schemas do not declare as a defect, in the input and in the output', async () => {
    const anvilWithExtra = { name: 'anvil', text: 'heavy', extra: 1 };

    expect(await Effect.runPromise(withNotes(schemaDefectOf(addNote.call(anvilWithExtra))))).toBe(true);
    expect(await Effect.runPromise(schemaDefectOf(overshare.call({})))).toBe(true);
  });
});
