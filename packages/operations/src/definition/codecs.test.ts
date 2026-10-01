import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineQuery } from '../index.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { holdTree } from '../testing/misbehaving.ts';
import { addNote, listNotes } from '../testing/notes.ts';

const toAlpha = toBrain('acme', 'alpha');

const inspect = defineQuery('brain', {
  name: 'inspect',
  title: 'Inspect',
  description: 'Takes keys that need escaping in a JSON Pointer.',
  route: { method: 'GET', path: '/inspect' },
  inputSchema: Schema.Struct({
    nested: Schema.optionalKey(
      Schema.Struct({ 'a/b': Schema.optionalKey(Schema.Int), 'c~d': Schema.optionalKey(Schema.Int) }),
    ),
    items: Schema.optionalKey(Schema.Array(Schema.Int)),
  }),
  outputSchema: Schema.Record(Schema.String, Schema.Never),
  reasons: [],
  handle: () => Effect.succeed({}),
});

function treeNested(depth: number): unknown {
  return JSON.parse(`${'{"children":['.repeat(depth)}${']}'.repeat(depth)}`);
}

describe('the input of a call', () => {
  it('is rejected with a pointer to every problem', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(dispatcher.inBrain(addNote.registration, toAlpha(acmeAdmin, { name: 'Anvil', 'a/b': 1 }))),
    ).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input does not match the input schema',
      issues: [
        { detail: 'Expected no excess property', pointer: '/a~1b' },
        { detail: 'Expected a string matching the RegExp ^[a-z][a-z0-9-]{0,31}$', pointer: '/name' },
        { detail: 'Missing key', pointer: '/text' },
      ],
    });
  });

  it('points into nested fields and items, escaping / and ~', async () => {
    const { dispatcher, run } = harness();
    const input = { nested: { 'a/b': 'x', 'c~d': 'y' }, items: [1, 'two'] };

    expect(await run(dispatcher.inBrain(inspect.registration, toAlpha(acmeAdmin, input)))).toMatchObject({
      issues: [{ pointer: '/nested/a~1b' }, { pointer: '/nested/c~0d' }, { pointer: '/items/1' }],
    });
  });
});

describe('an input that cannot be decoded', () => {
  it('is rejected with at most one hundred issues', async () => {
    const { dispatcher, run } = harness();
    const manyUnknownKeys = Object.fromEntries(Array.from({ length: 150 }, (_unused, index) => [`key${index}`, index]));

    expect(await run(dispatcher.inBrain(inspect.registration, toAlpha(acmeAdmin, manyUnknownKeys)))).toMatchObject({
      reason: 'invalid_input',
      issues: Array.from({ length: 100 }, () => ({ detail: 'Expected no excess property' })),
    });
  });

  it('is rejected, without failing the call, when it is nested too deeply to decode', async () => {
    const { dispatcher, reported, run } = harness();

    expect(await run(dispatcher.inBrain(holdTree.registration, toAlpha(acmeAdmin, { tree: treeNested(10) })))).toEqual({
      status: 'succeeded',
      output: { held: true },
    });
    expect(
      await run(dispatcher.inBrain(holdTree.registration, toAlpha(acmeAdmin, { tree: treeNested(5_000) }))),
    ).toEqual({
      status: 'rejected',
      reason: 'invalid_input',
      detail: 'The input is nested too deeply',
      issues: [{ detail: 'The input is nested too deeply', pointer: '' }],
    });
    expect(reported()).toEqual([]);
  });
});

function listing(input: unknown) {
  const { dispatcher, run } = harness();
  return run(dispatcher.inBrain(listNotes.registration, { ...toAlpha(acmeAdmin, input), form: 'strings' }));
}

describe('the input of a call as strings', () => {
  it('is decoded through the input schema, as from a query string', async () => {
    expect(await listing({ limit: '1' })).toEqual({ status: 'succeeded', output: { notes: [] } });
    expect(await listing({ limit: 'many' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ pointer: '/limit' }],
    });
  });

  it('rejects keys the schema does not declare, pointing at every problem', async () => {
    expect(await listing({ limit: 'many', other: 'x' })).toMatchObject({
      reason: 'invalid_input',
      issues: [{ detail: 'Expected no excess property', pointer: '/other' }, { pointer: '/limit' }],
    });
  });
});
