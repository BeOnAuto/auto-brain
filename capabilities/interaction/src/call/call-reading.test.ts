import type { Schema } from 'effect';
import { Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { callRuns } from '../testing/call-runs.ts';
import { callDocument } from '../testing/index.ts';

const anyOutput = ['output:', '  schema: {}'];

const open = ['input:', '  schema: { type: object }'];

function unworkable(detail: unknown) {
  return Exit.fail(expect.objectContaining({ _tag: 'conflict', kind: 'unworkable', detail }));
}

function nestedIn(levels: number): Schema.Json {
  return Array.from({ length: levels }).reduce<Schema.Json>((inner) => ({ n: inner }), 'leaf');
}

describe('a run that asks a system and cannot read what the tool answered', () => {
  it('is unworkable when the answer has no document, or nothing at read, in a structure or in a text', async () => {
    const { run } = await callRuns();

    expect([
      await run(callDocument({ tool: 'photo', read: null, with: [], output: anyOutput })),
      await run(callDocument({ read: '/nothing' })),
      await run(callDocument({ tool: 'search', read: '/rows', with: ['    query: acme'], output: anyOutput })),
    ]).toEqual([
      unworkable('The photo tool of chat answered neither structured content nor text, so there is nothing to read'),
      unworkable('The answer of the thread tool of chat holds nothing at /nothing'),
      unworkable('The search tool of chat answered text that is not JSON, which holds nothing at /rows'),
    ]);
  });

  it('is unworkable when what it reads takes more than 64 KiB, nests deeper than 512 levels, or does not match the output schema', async () => {
    const { run } = await callRuns();
    const deep = callDocument({
      tool: 'echo',
      read: null,
      with: ["    deep: { inner: '{{ input.deep }}' }"],
      input: open,
      output: anyOutput,
    });

    expect([
      await run(callDocument({ tool: 'large', read: null, with: ['    kib: 70'], output: anyOutput })),
      await run(deep, { deep: nestedIn(511) }),
      await run(callDocument({ output: ['output:', '  schema: { type: string }'] })),
    ]).toEqual([
      unworkable('What the large tool of chat answered takes 71682 bytes as JSON, more than the 65536 an answer may'),
      unworkable('What the echo tool of chat answered nests deeper than the 512 levels a value may'),
      unworkable(
        expect.stringMatching(
          /^What the thread tool of chat answered at \/messages does not match the output schema: the answer: /u,
        ),
      ),
    ]);
  });
});
