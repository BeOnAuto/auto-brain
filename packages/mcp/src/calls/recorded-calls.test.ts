import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { Effect } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { toolBounds } from '../bounds/call-bounds.ts';
import { secretsOf } from '../bounds/secrets.ts';
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
import { failedData, recordingOf } from './recorded-calls.ts';

type Call = readonly [string, Readonly<Record<string, unknown>>];

const closing: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
}, stdioTestTimeoutMs);

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

const aNumber: unknown = expect.any(Number);

const aText: unknown = expect.any(String);

const aRequestNumber: unknown = expect.stringMatching(/^request-\d+$/u);

const numericSecret = 31_415_926_535;

const alpha = { org: 'acme', brain: 'alpha' };

function referenceOf(written: string) {
  const [server = '', tool = ''] = written.split('/');
  return { server, tool };
}

function textAnswer(text: string): string {
  return JSON.stringify({ content: [{ type: 'text', text }] });
}

async function recordedCalls(
  entry: Readonly<Record<string, unknown>>,
  calls: readonly Call[],
  fakeOptions: FakeMcpOptions = {},
) {
  const fake = await serveFakeMcp({ bearer: fakeApiKey, ...fakeOptions });
  closing.push(fake.close);
  const { access, content } = reportingAccess(
    {
      graph: { url: fake.url, headers: { Authorization: 'Bearer ${GRAPH_API_KEY}' }, org: 'acme', ...entry },
      limitless: {
        command: process.execPath,
        args: [fakeStdioServerPath],
        env: { NODE_V8_COVERAGE: '${NODE_V8_COVERAGE:-}', LIMITLESS_PIN: '${LIMITLESS_PIN}' },
        org: 'acme',
        ...entry,
      },
    },
    {
      environment: {
        GRAPH_API_KEY: fakeApiKey,
        LIMITLESS_PIN: String(numericSecret),
        NODE_V8_COVERAGE: process.env['NODE_V8_COVERAGE'],
      },
      timing: patientTiming,
    },
  );
  closing.push(access.close);
  const journal = recordingCallJournal();
  const written = [...new Set(calls.map(([tool]) => tool))];
  const tools = await Effect.runPromise(
    access.open(
      toolRun(journal),
      written.map((tool) => referenceOf(tool)),
    ),
  );
  closing.push(tools.close);
  await inTurn(
    calls.map((_, index) => index),
    (index) =>
      Promise.resolve(
        tools.offered[written.indexOf(calls[index]?.[0] ?? '')]?.call(
          { callId: `call-${index + 1}`, input: calls[index]?.[1] ?? {} },
          controlledSignals(),
        ),
      ),
  );
  const kept = (sha256: string) => Effect.runPromise(content.get(alpha, sha256));
  return { facts: journal.facts(), kept };
}

describe('the facts of a call', () => {
  it('record the size and digest of the arguments and the answer, that the content was kept, and that its server marks the tool read-only', async () => {
    const { facts } = await recordedCalls({}, [['graph/search', { query: 'acme' }]]);

    expect(facts).toEqual([
      {
        number: 1,
        type: 'tool_call_started',
        data: {
          call_id: 'call-1',
          server: 'graph',
          tool: 'search',
          arguments_bytes: 16,
          arguments_sha256: digest('{"query":"acme"}'),
          content_kept: true,
          read_only: true,
        },
      },
      {
        number: 1,
        type: 'tool_call_answered',
        data: {
          is_error: false,
          result_bytes: Buffer.byteLength(textAnswer('Found 2 rows for acme.')),
          result_sha256: digest(textAnswer('Found 2 rows for acme.')),
          content_kept: true,
          duration_ms: aNumber,
          jsonrpc_id: aNumber,
        },
      },
    ]);
  });

  it('record a call the tool did not answer as failed, with no answer', async () => {
    const { facts } = await recordedCalls({}, [['graph/broken', { attempt: 1 }]]);

    expect(facts[1]).toEqual({
      number: 1,
      type: 'tool_call_failed',
      data: { because: 'server_failure', detail: aText, duration_ms: aNumber, jsonrpc_id: aNumber },
    });
  });
});

describe('the content of a call', () => {
  it('is kept whole as the protocol answer, scrubbed of secrets in keys, in values and as numbers', async () => {
    const input = { [fakeApiKey]: 'as a key', value: `the key ${fakeApiKey}`, pin: numericSecret };
    const { facts, kept } = await recordedCalls({}, [['graph/echo', input]]);
    const [started, answered] = facts;

    expect(started?.data).toMatchObject({ arguments_sha256: digest(JSON.stringify(input)), content_kept: true });
    expect(answered?.data).toMatchObject({ result_sha256: digest(textAnswer(JSON.stringify(input))) });
    await expect(kept(digest(JSON.stringify(input)))).resolves.toBe(
      '{"[redacted]":"as a key","value":"the key [redacted]","pin":"[redacted]"}',
    );
    await expect(kept(digest(textAnswer(JSON.stringify(input))))).resolves.toBe(
      textAnswer('{"[redacted]":"as a key","value":"the key [redacted]","pin":[redacted]}'),
    );
  });

  it('is kept as it was answered when nothing was scrubbed from it, so its digest verifies it', async () => {
    const answer = '{"content":[],"structuredContent":{"name":"Ada","rows":2}}';
    const { facts, kept } = await recordedCalls({}, [['graph/profile', {}]]);

    expect(facts[1]?.data).toMatchObject({ result_sha256: digest(answer), content_kept: true });
    await expect(kept(digest(answer))).resolves.toBe(answer);
  });
});

describe('the content of calls that answer alike, or of a server that keeps none', () => {
  it('is kept once for every call that receives it, and not at all where the entry turns keeping off', async () => {
    const twice = await recordedCalls({}, [
      ['graph/search', { query: 'same' }],
      ['graph/search', { query: 'same' }],
    ]);
    const unkept = await recordedCalls({ record_content: false }, [['graph/search', { query: 'same' }]]);
    const sha256 = digest(textAnswer('Found 2 rows for same.'));

    expect(twice.facts.map(({ data }) => data)).toEqual([
      expect.objectContaining({ arguments_sha256: digest('{"query":"same"}'), content_kept: true }),
      expect.objectContaining({ result_sha256: sha256, content_kept: true }),
      expect.objectContaining({ arguments_sha256: digest('{"query":"same"}'), content_kept: true }),
      expect.objectContaining({ result_sha256: sha256, content_kept: true }),
    ]);
    await expect(twice.kept(sha256)).resolves.toBe(textAnswer('Found 2 rows for same.'));
    expect(unkept.facts.map(({ data }) => data)).toEqual([
      expect.objectContaining({ content_kept: false }),
      expect.objectContaining({ result_sha256: sha256, content_kept: false }),
    ]);
    await expect(unkept.kept(sha256)).resolves.toBeUndefined();
  });

  it(
    'is kept whole at 5 MB and at 16 MiB over HTTP, and a larger answer fails the call',
    { timeout: 120_000 },
    async () => {
      const kib = toolBounds.httpAnswerBytes / 1024;
      const { facts, kept } = await recordedCalls({}, [
        ['graph/large', { kib: 4883 }],
        ['graph/large', { kib: kib - 1 }],
        ['graph/large', { kib }],
      ]);
      const answers = facts.filter(({ type }) => type !== 'tool_call_started');
      const fiveMegabytes = textAnswer('😀'.repeat(4883 * 256));
      const sixteenMebibytes = textAnswer('😀'.repeat((kib - 1) * 256));

      expect(answers.map(({ type, data }) => [type, data])).toEqual([
        ['tool_call_answered', expect.objectContaining({ result_bytes: Buffer.byteLength(fiveMegabytes) })],
        ['tool_call_answered', expect.objectContaining({ result_bytes: Buffer.byteLength(sixteenMebibytes) })],
        ['tool_call_failed', expect.objectContaining({ because: 'server_failure' })],
      ]);
      await expect(kept(digest(fiveMegabytes))).resolves.toBe(fiveMegabytes);
      await expect(kept(digest(sixteenMebibytes))).resolves.toBe(sixteenMebibytes);
    },
  );
});

describe('the id a server gives a request', () => {
  it('records it from a header or from the metadata of the result', async () => {
    const fromHeader = await recordedCalls({ request_id: 'x-request-id' }, [['graph/search', { query: 'a' }]], {
      requestIdHeader: 'x-request-id',
    });
    const fromMeta = await recordedCalls({ request_id: fakeRequestIdKey }, [['graph/search', { query: 'a' }]]);

    expect(fromHeader.facts[1]?.data).toMatchObject({ server_request_id: aRequestNumber });
    expect(fromMeta.facts[1]?.data).toMatchObject({ server_request_id: 'call-1' });
  });

  it('records none when the server gives none, or the call failed', async () => {
    const missing = await recordedCalls({ request_id: 'x-request-id' }, [['graph/search', { query: 'a' }]]);
    const failed = await recordedCalls({ request_id: fakeRequestIdKey }, [['graph/broken', {}]]);

    expect(missing.facts[1]?.data).toMatchObject({ server_request_id: null });
    expect(failed.facts[1]).toMatchObject({ type: 'tool_call_failed', data: { server_request_id: null } });
  });

  it('records the JSON-RPC id of a call over stdio', { timeout: stdioTestTimeoutMs }, async () => {
    const { facts } = await recordedCalls({ request_id: fakeRequestIdKey }, [['limitless/search', { query: 'acme' }]]);

    expect(facts[1]).toMatchObject({
      type: 'tool_call_answered',
      data: { is_error: false, jsonrpc_id: aNumber, server_request_id: 'call-1' },
    });
  });
});

describe('the failure of a call', () => {
  it('carries no detail when the failure said nothing', () => {
    const recording = recordingOf({ record_content: true, request_id: null }, secretsOf([]), () => Promise.resolve());

    expect(
      failedData({ because: 'cancelled', message: '  ', jsonrpcId: null, serverRequestId: null }, 0, recording),
    ).toEqual({ because: 'cancelled', duration_ms: 0, jsonrpc_id: null });
  });
});
