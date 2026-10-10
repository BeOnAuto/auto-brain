import { Effect, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { answerDocument } from '../bounds/tool-results.ts';
import {
  fakeApiKey,
  patientTiming,
  reportingAccess,
  serveFakeMcp,
  threadReplies,
  toolTests,
} from '../testing/index.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const decodeTested = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ text: Schema.String, answer: Schema.optionalKey(Schema.Json) }) }),
);

async function testedAndCalled(tool: string, input: Readonly<Record<string, unknown>> = {}) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey, data: true });
  closing.push(fake.close);
  const graph = { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme' };
  const { access } = reportingAccess({ graph }, { timing: patientTiming, environment: { GRAPH_API_KEY: fakeApiKey } });
  closing.push(access.close);
  const tested = decodeTested(await toolTests(access).test({ server: 'graph', tool, arguments: input })).output;
  const call = { org: 'acme', brain: 'alpha', reference: { server: 'graph', tool }, input, meta: {} };
  const called = await Effect.runPromise(access.callOnce(call));
  return {
    tested,
    document: called.kind === 'answered' && called.outcome === 'result' ? answerDocument(called.answer) : undefined,
  };
}

describe('the answer of a test', () => {
  it('is the document a call reads, the structure beside a summary the model sees', async () => {
    const { tested, document } = await testedAndCalled('thread');

    expect(tested).toEqual({
      text: '2 replies in the thread.',
      answer: { ok: true, messages: threadReplies, has_more: false },
    });
    expect(tested.answer).toEqual(document);
  });

  it('is the first of several text blocks read as JSON, and a text that is not JSON as that text', async () => {
    const blocks = await testedAndCalled('blocks');
    const plain = await testedAndCalled('search', { query: 'acme' });

    expect([blocks.tested.answer, plain.tested.answer]).toEqual([{ page: 1 }, 'Found 2 rows for acme.']);
    expect([blocks.tested.answer, plain.tested.answer]).toEqual([blocks.document, plain.document]);
  });

  it('is the structure of each page of a tool that pages, and the JSON of a text', async () => {
    const first = await testedAndCalled('pages');
    const last = await testedAndCalled('pages', { cursor: 'p2' });
    const counted = await testedAndCalled('strict', { limit: 3 });

    expect([first.tested.answer, last.tested.answer, counted.tested.answer]).toEqual([
      { items: [1, 2], next: 'p2' },
      { items: [3], next: null },
      { limit: 3 },
    ]);
  });

  it('is left out when the tool answered neither structured content nor text, and when it takes more than 64 KiB', async () => {
    const photo = await testedAndCalled('photo');
    const large = await testedAndCalled('large', { kib: 70 });

    expect(['answer' in photo.tested, 'answer' in large.tested]).toEqual([false, false]);
    expect([photo.document, typeof large.document]).toEqual([undefined, 'string']);
  });
});
