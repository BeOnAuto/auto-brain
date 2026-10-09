import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import { brokenPromise, deniedText } from '../testing/index.ts';
import {
  calledOnce,
  echoCall,
  callingRunId,
  oneCallAccess,
  deliveryId,
  oneCallKey,
  oneCallServer,
  failedWith,
  unopenedWith,
} from '../testing/one-calls.ts';

const largeText = '\u{1F600}'.repeat(8 * 256);

const largeAnswerBytes = Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: largeText }] }));

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const aNumber: unknown = expect.any(Number);

const scrubbed = JSON.stringify({ token: '[redacted]' });

describe('one call of a tool', () => {
  it('lists the tools of its server, calls the tool with the metadata its caller gives, and answers the call whole', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url);

    expect(await calledOnce(access)).toEqual({
      kind: 'answered',
      outcome: 'result',
      fields: { result_bytes: 95, result_sha256: aDigest, jsonrpc_id: aNumber },
      answer: { content: [{ type: 'text', text: JSON.stringify(echoCall.input) }] },
      durationMs: aNumber,
      detail: '',
      retryAfterMs: null,
      annotations: undefined,
    });
    expect(access.startOf(echoCall)).toEqual({
      server: 'graph',
      tool: 'echo',
      arguments_bytes: 48,
      arguments_sha256: aDigest,
    });
    expect(fake.received()).toEqual([
      {
        tool: 'echo',
        arguments: echoCall.input,
        meta: { 'com.beonauto/run_id': callingRunId, 'com.beonauto/delivery_id': deliveryId },
      },
    ]);
  });

  it('lists the tools of its server before it calls one', async () => {
    const fake = await oneCallServer();
    await calledOnce(oneCallAccess(fake.url));
    const asked = fake.seen().map(({ rpc }) => rpc);

    expect(asked.indexOf('tools/list')).toBeGreaterThan(-1);
    expect(asked.indexOf('tools/list')).toBeLessThan(asked.indexOf('tools/call'));
  });
});

describe('what one call answers of its tool', () => {
  it('answers the hints the server gives the tool it listed', async () => {
    const fake = await oneCallServer();

    expect(await calledOnce(oneCallAccess(fake.url), { reference: { server: 'graph', tool: 'search' } })).toMatchObject(
      { outcome: 'result', annotations: { readOnlyHint: true, openWorldHint: true } },
    );
  });

  it('records the arguments and the answer, scrubbed, where the server records its content', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url, { record_content: true });
    const call = { ...echoCall, input: { token: oneCallKey } };

    const called = await calledOnce(access, call);

    expect([
      access.startOf(call),
      access.startOf({ ...call, reference: { server: 'wiki', tool: 'echo' } }),
    ]).toMatchObject([{ arguments_json: scrubbed }, { server: 'wiki', arguments_bytes: 36 }]);
    expect(access.startOf({ ...call, reference: { server: 'wiki', tool: 'echo' } })).not.toHaveProperty(
      'arguments_json',
    );
    expect(called).toMatchObject({
      fields: { result_json: JSON.stringify({ content: [{ type: 'text', text: scrubbed }] }) },
    });
  });
});

describe('a call that fails', () => {
  it('is a tool error in the words of the tool when it answers with one, and in the words of the server when it refuses the arguments', async () => {
    const fake = await oneCallServer({ data: true });
    const access = oneCallAccess(fake.url, { allowed: ['denied', 'strict'] });

    expect(await calledOnce(access, { reference: { server: 'graph', tool: 'denied' } })).toMatchObject({
      ...failedWith('tool_error', deniedText),
      fields: { result_bytes: aNumber },
    });
    expect(
      await calledOnce(access, { reference: { server: 'graph', tool: 'strict' }, input: { limit: '15' } }),
    ).toMatchObject({
      ...failedWith('tool_error', expect.stringContaining('limit must be a whole number')),
      fields: { result_bytes: null },
    });
  });

  it('is not opened for a tool its server does not list, and nothing is sent', async () => {
    const fake = await oneCallServer();

    expect(await calledOnce(oneCallAccess(fake.url), { reference: { server: 'graph', tool: 'gone' } })).toEqual(
      unopenedWith('tool_not_offered', 'tool_not_listed', 'The MCP server graph does not list the tool gone'),
    );
    expect(fake.received()).toEqual([]);
  });

  it('ends at its call bound', async () => {
    const fake = await oneCallServer();
    const sleeping = { reference: { server: 'graph', tool: 'sleep' }, input: { ms: 5000 } };

    expect(await calledOnce(oneCallAccess(fake.url, {}, { callMs: 200 }), sleeping)).toMatchObject({
      ...failedWith('timed_out', 'The MCP server did not answer within 200 ms'),
      fields: { result_bytes: null, result_sha256: null },
    });
  });
});

describe('what a tool answers', () => {
  it('is carried whole, its content and its structured content, and counted', async () => {
    const fake = await oneCallServer();
    const access = oneCallAccess(fake.url);

    const large = await calledOnce(access, { reference: { server: 'graph', tool: 'large' }, input: { kib: 8 } });
    const structured = await calledOnce(access, { reference: { server: 'graph', tool: 'profile' }, input: {} });

    expect(large).toMatchObject({
      outcome: 'result',
      answer: { content: [{ type: 'text', text: largeText }] },
      fields: { result_bytes: largeAnswerBytes },
    });
    expect(structured).toMatchObject({
      outcome: 'result',
      answer: { content: [], structuredContent: { name: 'Ada', rows: 2 } },
    });
  });

  it('is scrubbed of the secrets of the server before the caller reads it', async () => {
    const fake = await oneCallServer();

    expect(await calledOnce(oneCallAccess(fake.url), { input: { token: oneCallKey } })).toMatchObject({
      outcome: 'result',
      answer: { content: [{ type: 'text', text: scrubbed }] },
    });
  });
});

describe('one call of a tool that declares an output schema', () => {
  it('answers what a tool answered against its own output schema, as it answered it', async () => {
    const fake = await oneCallServer({ data: true });

    expect(
      await calledOnce(oneCallAccess(fake.url), { reference: { server: 'graph', tool: 'promised' } }),
    ).toMatchObject({
      kind: 'answered',
      outcome: 'result',
      answer: { structuredContent: brokenPromise },
    });
    expect(fake.received()).toHaveLength(1);
  });
});
