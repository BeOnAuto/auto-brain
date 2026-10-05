import { createHash } from 'node:crypto';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import {
  controlledSignals,
  fakeApiKey,
  fakeRequestIdKey,
  fakeStdioServerPath,
  inTurn,
  patientTiming,
  recordingCallJournal,
  reportingAccess,
  serveFakeMcp,
  stdioTestTimeoutMs,
  toolRun,
  type FakeMcpOptions,
} from '../testing/index.ts';
import type { RecordedCall } from './recorded-calls.ts';

type Call = readonly [string, Readonly<Record<string, unknown>>];

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
}, stdioTestTimeoutMs);

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

const aNumber: unknown = expect.any(Number);

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const scrubbedArguments: unknown = expect.stringMatching(/^\{"key":"\[redacted\]","text":"x+$/u);

const scrubbedResult: unknown = expect.stringMatching(
  /^\{"_meta":\{"com\.example\/request_id":"call-1"\},"content":.*\[redacted\]/u,
);

const aRequestNumber: unknown = expect.stringMatching(/^request-\d+$/u);

function referenceOf([written]: Call) {
  const [server = '', tool = ''] = written.split('/');
  return { server, tool };
}

function recordedArgumentsLength(fact: RecordedCall | undefined): number {
  return fact?.type === 'tool_call_started' ? String(fact.arguments_json).length : 0;
}

async function recordedCalls(
  entry: Readonly<Record<string, unknown>>,
  calls: readonly Call[],
  fakeOptions: FakeMcpOptions = {},
) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey, ...fakeOptions });
  closing.push(fake.close);
  const { access } = reportingAccess(
    {
      graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry },
      limitless: {
        command: process.execPath,
        args: [fakeStdioServerPath],
        env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}' },
        org: 'acme',
        ...entry,
      },
    },
    {
      environment: { GRAPH_API_KEY: fakeApiKey, NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'] },
      timing: patientTiming,
    },
  );
  closing.push(access.close);
  const journal = recordingCallJournal();
  const tools = await Effect.runPromise(
    access.open(
      toolRun(journal),
      calls.map((call) => referenceOf(call)),
    ),
  );
  closing.push(tools.close);
  await inTurn(
    calls.map((_, index) => index),
    (index) =>
      Promise.resolve(
        tools.offered[index]?.call(
          { callId: `call-${index + 1}`, input: calls[index]?.[1] ?? {} },
          controlledSignals(),
        ),
      ),
  );
  return journal.facts();
}

describe('the events of a call', () => {
  it('records the size and digest of the arguments and the result, and no content', async () => {
    expect(await recordedCalls({}, [['graph/search', { query: 'acme' }]])).toEqual([
      {
        type: 'tool_call_started',
        number: 1,
        call_id: 'call-1',
        server: 'graph',
        tool: 'search',
        arguments_bytes: 16,
        arguments_sha256: digest('{"query":"acme"}'),
      },
      {
        type: 'tool_call_answered',
        number: 1,
        outcome: 'result',
        result_bytes: aNumber,
        result_sha256: aDigest,
        duration_ms: aNumber,
        jsonrpc_id: aNumber,
      },
    ]);
  });

  it('records no result for a call that failed', async () => {
    const [, answered] = await recordedCalls({}, [['graph/broken', { attempt: 1 }]]);

    expect(answered).toEqual({
      type: 'tool_call_answered',
      number: 1,
      outcome: 'server_failure',
      result_bytes: null,
      result_sha256: null,
      duration_ms: aNumber,
      jsonrpc_id: aNumber,
    });
  });
});

describe('the content of a call', () => {
  it('records the content, cut to 4 KiB and scrubbed, where the entry says so', async () => {
    const input = { key: fakeApiKey, text: 'x'.repeat(5000) };
    const facts = await recordedCalls({ record_content: true }, [['graph/echo', input]]);

    expect(facts[0]).toMatchObject({
      arguments_bytes: JSON.stringify(input).length,
      arguments_json: scrubbedArguments,
    });
    expect(recordedArgumentsLength(facts[0])).toBe(4096);
    expect(facts[1]).toMatchObject({ result_json: scrubbedResult });
    expect(JSON.stringify(facts)).not.toContain(fakeApiKey);
  });
});

describe('the id a server gives a request', () => {
  it('records it from a header or from the metadata of the result', async () => {
    const fromHeader = await recordedCalls({ request_id: 'x-request-id' }, [['graph/search', { query: 'a' }]], {
      requestIdHeader: 'x-request-id',
    });
    const fromMeta = await recordedCalls({ request_id: fakeRequestIdKey }, [['graph/search', { query: 'a' }]]);

    expect(fromHeader[1]).toMatchObject({ server_request_id: aRequestNumber });
    expect(fromMeta[1]).toMatchObject({ server_request_id: 'call-1' });
  });

  it('records none when the server gives none, or the call failed', async () => {
    const missing = await recordedCalls({ request_id: 'x-request-id' }, [['graph/search', { query: 'a' }]]);
    const failed = await recordedCalls({ request_id: fakeRequestIdKey }, [['graph/broken', {}]]);

    expect(missing[1]).toMatchObject({ server_request_id: null });
    expect(failed[1]).toMatchObject({ outcome: 'server_failure', server_request_id: null });
  });

  it('records the JSON-RPC id of a call over stdio', { timeout: stdioTestTimeoutMs }, async () => {
    const facts = await recordedCalls({ request_id: fakeRequestIdKey }, [['limitless/search', { query: 'acme' }]]);

    expect(facts[1]).toMatchObject({ outcome: 'result', jsonrpc_id: aNumber, server_request_id: 'call-1' });
  });
});
