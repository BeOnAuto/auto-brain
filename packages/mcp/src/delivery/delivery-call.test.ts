import { Buffer } from 'node:buffer';

import { describe, expect, it } from 'vitest';

import {
  calledOnce,
  delivery,
  deliveredRunId,
  deliveryAccess,
  deliveryId,
  deliveryKey,
  deliveryServer,
  failedWith,
} from '../testing/delivery-calls.ts';
import { deliveryBounds } from './delivery-bounds.ts';

const largeText = '\u{1F600}'.repeat(8 * 256);

const largeAnswerBytes = Buffer.byteLength(JSON.stringify({ content: [{ type: 'text', text: largeText }] }));

const aDigest: unknown = expect.stringMatching(/^[0-9a-f]{64}$/u);

const aNumber: unknown = expect.any(Number);

const scrubbed = JSON.stringify({ token: '[redacted]' });

describe('one call of a tool for a delivery', () => {
  it('calls the tool with its arguments and the metadata its caller gives, and answers the call whole', async () => {
    const fake = await deliveryServer();
    const access = deliveryAccess(fake.url);

    expect(await calledOnce(access)).toEqual({
      kind: 'answered',
      outcome: 'result',
      fields: { result_bytes: 95, result_sha256: aDigest, jsonrpc_id: aNumber },
      answer: { content: [{ type: 'text', text: JSON.stringify(delivery.input) }] },
      durationMs: aNumber,
      detail: '',
      retryAfterMs: null,
    });
    expect(access.startOf(delivery)).toEqual({
      server: 'graph',
      tool: 'echo',
      arguments_bytes: 48,
      arguments_sha256: aDigest,
    });
    expect(fake.received()).toEqual([
      {
        tool: 'echo',
        arguments: delivery.input,
        meta: { 'com.beonauto/run_id': deliveredRunId, 'com.beonauto/delivery_id': deliveryId },
      },
    ]);
    expect(fake.seen().map(({ rpc }) => rpc)).not.toContain('tools/list');
  });

  it('records the arguments and the answer, scrubbed, where the server records its content', async () => {
    const fake = await deliveryServer();
    const access = deliveryAccess(fake.url, { record_content: true });
    const call = { ...delivery, input: { token: deliveryKey } };

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

describe('a call for a delivery that fails', () => {
  it('is a tool error when the tool answers with one, or the server does not have the tool', async () => {
    const fake = await deliveryServer();
    const access = deliveryAccess(fake.url);

    expect(await calledOnce(access, { reference: { server: 'graph', tool: 'denied' } })).toMatchObject(
      failedWith('tool_error', expect.stringContaining('The field salary is denied by the policy')),
    );
    expect(await calledOnce(access, { reference: { server: 'graph', tool: 'gone' } })).toMatchObject(
      failedWith('tool_error', expect.stringContaining('Tool gone not found')),
    );
  });

  it('ends at its call bound, waiting no longer than a delivery may', async () => {
    const fake = await deliveryServer();
    const sleeping = { reference: { server: 'graph', tool: 'sleep' }, input: { ms: 5000 } };

    expect(await calledOnce(deliveryAccess(fake.url, {}, 200), sleeping)).toMatchObject({
      ...failedWith('timed_out', 'The MCP server did not answer within 200 ms'),
      fields: { result_bytes: null, result_sha256: null },
    });
    expect(deliveryBounds).toMatchObject({ connectionMs: 10_000, callMs: 30_000 });
  });
});

describe('what a tool answers a delivery', () => {
  it('is carried whole, its content and its structured content, and counted', async () => {
    const fake = await deliveryServer();
    const access = deliveryAccess(fake.url);

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
    const fake = await deliveryServer();

    expect(await calledOnce(deliveryAccess(fake.url), { input: { token: deliveryKey } })).toMatchObject({
      outcome: 'result',
      answer: { content: [{ type: 'text', text: scrubbed }] },
    });
  });
});
