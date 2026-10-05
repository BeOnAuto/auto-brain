import { InvalidInput } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineExecuteSpec, definePrimitive, type ExecutionContext, type PrimitiveDefinition } from '../index.ts';

const parseWords = (source: string) =>
  source.trim() === ''
    ? Effect.fail(
        new InvalidInput({ detail: 'The document is empty', issues: [{ detail: 'Line 1 is empty', pointer: '' }] }),
      )
    : Effect.succeed({ words: source.trim().split(/\s+/u) });

const words: PrimitiveDefinition<{ readonly words: readonly string[] }> = {
  name: 'words',
  title: 'Words',
  description: 'Counts the words of its document.',
  noun: { one: 'count', other: 'counts' },
  describeOutput: () => 'It counted the words.',
  mediaType: 'text/plain',
  parse: parseWords,
  summarize: (parsed) => ({ description: `${parsed.words.length} words` }),
  execute: (parsed, input, execution) =>
    Effect.succeed({ output: { words: parsed.words, input }, record: { execution: execution.id } }),
};

const execution: ExecutionContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  brain: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: ['brain:write'], brains: '*' },
  spec: { name: 'count', version: 3 },
};

describe('a primitive', () => {
  it('keeps its name, title, description, noun, words for an output and media type', () => {
    const primitive = definePrimitive(words);

    expect(primitive).toMatchObject({
      name: 'words',
      title: 'Words',
      description: 'Counts the words of its document.',
      noun: { one: 'count', other: 'counts' },
      mediaType: 'text/plain',
    });
    expect(primitive.describeOutput({ words: [] })).toBe('It counted the words.');
  });

  it('runs an execution for at most the time it states, or 10 minutes when it states none', () => {
    expect([definePrimitive(words), definePrimitive({ ...words, longestExecutionMs: 1_660_000 })]).toMatchObject([
      { longestExecutionMs: 600_000 },
      { longestExecutionMs: 1_660_000 },
    ]);
  });

  it.each(['ab', 'Words', '1words', 'word_s', `w${'o'.repeat(32)}`])('may not be named %j', (name) => {
    expect(() => definePrimitive({ ...words, name })).toThrow(`The primitive name ${name} is malformed`);
  });

  it('prepares a document by parsing it once, and summarizes and executes what it parsed', async () => {
    const prepared = await Effect.runPromise(definePrimitive(words).prepare(' one two  three '));

    expect(prepared.summary).toEqual({ description: '3 words' });
    expect(await Effect.runPromise(prepared.execute({ shout: true }, execution))).toEqual({
      output: { words: ['one', 'two', 'three'], input: { shout: true } },
      record: { execution: execution.id },
    });
  });

  it('fails to prepare a document its parser rejects, with the issues the parser found', async () => {
    expect(await Effect.runPromise(Effect.flip(definePrimitive(words).prepare('  ')))).toEqual(
      new InvalidInput({ detail: 'The document is empty', issues: [{ detail: 'Line 1 is empty', pointer: '' }] }),
    );
  });
});

describe('the reach of a primitive', () => {
  it('reaches systems outside the server only when it says so, and so does execute_spec when one of its primitives does', () => {
    const local = definePrimitive(words);
    const outside = definePrimitive({ ...words, name: 'lookup', reachesOutside: true });

    expect([local.reachesOutside, outside.reachesOutside]).toEqual([false, true]);
    expect([
      defineExecuteSpec([local]).registration.reachesOutside,
      defineExecuteSpec([local, outside]).registration.reachesOutside,
    ]).toEqual([false, true]);
  });
});
