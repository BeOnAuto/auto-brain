import { Buffer } from 'node:buffer';

import type { KeptContent, RecordedEvent } from '@beonauto/operations';
import { nothingKept } from '@beonauto/operations/testing';
import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  fakeApiKey,
  fakeRequestIdKey,
  inTurn,
  patientTiming,
  reportingAccess,
  serveFakeMcp,
  toolTests,
} from '../testing/index.ts';
import { toolTestPresenter } from './tool-test-presenter.ts';

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

const givenUpAfterMs = 300;

const alpha = { org: 'acme', brain: 'alpha' };

const digestFields = ['arguments_sha256', 'result_sha256'];

async function recordedTests(entry: Readonly<Record<string, unknown>>, callMs: number, ...tested: readonly unknown[]) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey });
  closing.push(fake.close);
  const graph = {
    url: fake.url,
    headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' },
    org: 'acme',
    testable: ['echo'],
    ...entry,
  };
  const { access, content } = reportingAccess(
    { graph },
    { timing: { ...patientTiming, callMs }, environment: { GRAPH_API_KEY: fakeApiKey } },
  );
  closing.push(access.close);
  const { test, recorded } = toolTests(access);
  await inTurn(tested, (input) => test(input));
  const records = await recorded();
  const digests = records
    .flatMap(({ data }) => digestFields.map((field): unknown => Reflect.get(new Object(data), field)))
    .filter((digest): digest is string => typeof digest === 'string');
  const texts = await Promise.all(digests.map((digest) => Effect.runPromise(content.get(alpha, digest))));
  const kept = new Map(digests.map((digest, index) => [digest, texts[index]]));
  return { records, content: (sha256: string) => kept.get(sha256) };
}

const answering = [
  { server: 'graph', tool: 'search', arguments: { query: 'acme' } },
  { server: 'graph', tool: 'denied' },
  { server: 'graph', tool: 'broken' },
];

const sleeping = { server: 'graph', tool: 'sleep', arguments: { ms: 5000 } };

function shown(records: readonly RecordedEvent[], content: KeptContent = nothingKept) {
  return records.flatMap((record) => toolTestPresenter.present(record, content));
}

describe('the events of a test, as the brain shows them', () => {
  it('say which tool of which server was tested and how it answered, in the words of a run’s calls', async () => {
    const answered = await recordedTests({}, patientTiming.callMs, ...answering);
    const givenUp = await recordedTests({}, givenUpAfterMs, sleeping);
    const records = [...answered.records, ...givenUp.records];

    expect(shown(records).map(({ type, summary }) => `${type}: ${summary}`)).toEqual([
      'tool_test_started: Someone allowed to change the brain tested the search tool of graph.',
      'tool_test_answered: The tested tool answered.',
      'tool_test_started: Someone allowed to change the brain tested the denied tool of graph.',
      'tool_test_answered: The tested tool answered with an error of its own.',
      'tool_test_started: Someone allowed to change the brain tested the broken tool of graph.',
      'tool_test_failed: The tested tool failed at its server.',
      'tool_test_started: Someone allowed to change the brain tested the sleep tool of graph.',
      'tool_test_failed: The tested tool took too long, so it was given up.',
    ]);
    expect(records.map(({ context }) => context.by)).toEqual(Array.from({ length: 8 }, () => 'acme-builder'));
  });

  it('show the arguments and the answer the test kept, and the server’s own id of the request', async () => {
    const { records, content } = await recordedTests({ request_id: fakeRequestIdKey }, patientTiming.callMs, {
      server: 'graph',
      tool: 'echo',
      arguments: { said: 'hello' },
    });
    const [started, answered] = shown(records, content);

    expect(started?.data).toMatchObject({
      server: 'graph',
      tool: 'echo',
      arguments_bytes: Buffer.byteLength(JSON.stringify({ said: 'hello' })),
      content_kept: true,
      arguments: { said: 'hello' },
    });
    expect(answered?.data).toMatchObject({
      is_error: false,
      server_request_id: 'call-1',
      result: { content: [{ type: 'text', text: '{"said":"hello"}' }] },
      answer: { said: 'hello' },
    });
  });
});

describe('an answer that carries no id of the server', () => {
  it('shows an id the brain gave as text, cut to its bound, and no content it did not keep', () => {
    const [failed] = toolTestPresenter.present(
      {
        id: '1f0e8d7c-6b5a-5d4c-8b3a-291817161514',
        cursor: 'c',
        causationId: null,
        correlationId: null,
        stream: 'tool-tests/0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b',
        version: 2,
        globalPosition: 4,
        type: 'tool_test_failed',
        data: {
          test_id: '0199b7e2-4c1d-7a3e-8f5b-6d2c1e0f9a8b',
          because: 'server_failure',
          duration_ms: 12,
          jsonrpc_id: `request-${'7'.repeat(300)}`,
          server_request_id: 'r'.repeat(300),
        },
        context: { at: '2026-10-08T09:00:00.000Z', by: 'acme-builder' },
        recordedAt: '2026-10-08T09:00:00.000Z',
      },
      nothingKept,
    );

    expect(failed?.data).toMatchObject({
      jsonrpc_id: `request-${'7'.repeat(120)}`,
      server_request_id: 'r'.repeat(256),
    });
  });
});
