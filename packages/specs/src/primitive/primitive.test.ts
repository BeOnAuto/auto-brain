import { InvalidInput } from '@beonauto/operations';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineExecuteSpec, definePrimitive, type RunContext, type PrimitiveDefinition } from '../index.ts';
import { noLongestRuns } from '../testing/longest-runs.ts';
import { recordingJournal } from '../testing/recording-journal.ts';
import { answerOfCall, startOfCall } from '../testing/tool-user.ts';

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

const execution: RunContext = {
  id: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a',
  org: 'acme',
  brain: 'alpha',
  caller: { id: 'acme-admin', org: 'acme', permissions: ['brain:write'], brains: '*' },
  spec: { name: 'count', version: 3 },
  journal: recordingJournal(),
  lineage: { startId: '5d0e9f6a-1b2c-5d3e-8f4a-6b7c8d9e0f1a', correlationId: '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a' },
  depth: 0,
  callDepth: 0,
  longestRunOf: noLongestRuns,
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

describe('the change a primitive may make outside the server', () => {
  it('is none unless it says so, and execute_spec may change the outside when one of its primitives may', () => {
    const local = definePrimitive(words);
    const acting = definePrimitive({ ...words, name: 'acting', reachesOutside: true, mayChangeOutside: true });

    expect([local.mayChangeOutside, acting.mayChangeOutside]).toEqual([false, true]);
    expect([
      defineExecuteSpec([local]).registration.mayChangeOutside,
      defineExecuteSpec([local, acting]).registration.mayChangeOutside,
    ]).toEqual([false, true]);
  });
});

describe('a journal that records in memory, for tests', () => {
  it('keeps what it records, numbering the calls it starts, and refuses what it is told to', async () => {
    const journal = recordingJournal(({ type }) => type === 'tool_call_answered');
    const refusingStarts = recordingJournal(({ type }) => type === 'tool_call_started');

    expect(await Effect.runPromise(journal.started(startOfCall(1)))).toBe(1);
    expect(await Effect.runPromise(journal.started(startOfCall(2)))).toBe(2);
    expect(await Effect.runPromise(journal.answered(answerOfCall(1)))).toBe(false);
    expect(journal.recorded()).toEqual([
      { ...startOfCall(1), number: 1 },
      { ...startOfCall(2), number: 2 },
    ]);
    expect(await Effect.runPromise(recordingJournal().answered(answerOfCall(2)))).toBe(true);
    expect(await Effect.runPromise(refusingStarts.started(startOfCall(1)))).toBeUndefined();
  });
});

describe('what a primitive declares of its runs', () => {
  it('is known to a run in a test by none of the definitions it might call', async () => {
    expect(await Effect.runPromise(execution.longestRunOf('probe', 'plain'))).toBeUndefined();
  });

  it('is that they end within their call, within its longest run, unless it says otherwise', async () => {
    const plain = await Effect.runPromise(definePrimitive(words).prepare('one two'));
    const later = await Effect.runPromise(
      definePrimitive({
        ...words,
        finishesLater: true,
        longestRunOf: ({ words: given }) => given.length * 1000,
      }).prepare('one two'),
    );

    expect([plain, later]).toMatchObject([
      { finishesLater: false, longestRunMs: 600_000 },
      { finishesLater: true, longestRunMs: 2000 },
    ]);
  });

  it('cancels a run by settling it as cancelled with the kind and reason asked, unless it decides otherwise', () => {
    const asked = { record: { step: 1 }, kind: 'deadline', reason: 'The step ran out of time' } as const;
    const deciding = definePrimitive({
      ...words,
      cancel: ({ record }) => ({ status: 'rejected', reason: 'conflict', detail: `At step ${JSON.stringify(record)}` }),
    });

    expect([definePrimitive(words).cancel(asked), deciding.cancel(asked)]).toEqual([
      { status: 'rejected', reason: 'cancelled', kind: 'deadline', detail: 'The step ran out of time' },
      { status: 'rejected', reason: 'conflict', detail: 'At step {"step":1}' },
    ]);
  });
});
