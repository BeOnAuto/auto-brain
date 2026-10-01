import { InvalidInput } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { definePrimitive, type ExecutionContext, type PrimitiveDefinition } from '../index.ts';

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
  spec: { name: 'count', version: 3 },
};

describe('a primitive', () => {
  it('keeps its name, title, description and media type', () => {
    expect(definePrimitive(words)).toMatchObject({
      name: 'words',
      title: 'Words',
      description: 'Counts the words of its document.',
      mediaType: 'text/plain',
    });
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
