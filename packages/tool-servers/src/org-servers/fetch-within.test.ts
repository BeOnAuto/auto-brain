import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { fetchWithin } from './fetch-within.ts';

const SentInitSchema = Schema.Struct({
  redirect: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  duplex: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.instanceOf(Headers)),
  body: Schema.optional(Schema.instanceOf(ReadableStream)),
});

interface Sent {
  readonly address: unknown;
  readonly init: typeof SentInitSchema.Type;
}

function recording() {
  const sent: Sent[] = [];
  const fetch = (address: unknown, init?: unknown): Promise<Response> => {
    sent.push({ address, init: Schema.decodeUnknownSync(SentInitSchema)(init ?? {}) });
    return Promise.resolve(new Response('answered'));
  };
  return { sent, fetch };
}

function everywhere(): string | undefined {
  return undefined;
}

const rule = 'A connection may not reach the host elsewhere.example.org on this runtime, which allows *.example.com';

describe('a fetch held within the hosts of a connection', () => {
  it('sends to the address of a string, a URL or a request, and follows no redirect', async () => {
    const { sent, fetch } = recording();
    const within = fetchWithin(fetch, everywhere);

    await within('https://graph.example.com/mcp');
    await within(new URL('https://graph.example.com/url'), 'not an init');
    await within(new Request('https://graph.example.com/request', { method: 'DELETE', headers: { 'x-a': '1' } }));

    expect(sent.map(({ address, init }) => [address, init.redirect, init.method])).toEqual([
      ['https://graph.example.com/mcp', 'manual', undefined],
      ['https://graph.example.com/url', 'manual', undefined],
      ['https://graph.example.com/request', 'manual', 'DELETE'],
    ]);
    expect(new Headers(sent[2]?.init.headers).get('x-a')).toBe('1');
  });

  it('sends the body of a request, and the init given beside it over the fields of the request', async () => {
    const { sent, fetch } = recording();
    const within = fetchWithin(fetch, everywhere);
    const request = new Request('https://graph.example.com/mcp', { method: 'POST', body: '{"jsonrpc":"2.0"}' });

    await within(request, { method: 'PUT', redirect: 'follow' });

    expect([sent[0]?.init.method, sent[0]?.init.redirect, sent[0]?.init.duplex]).toEqual(['PUT', 'manual', 'half']);
    expect(sent[0]?.init.body).toBe(request.body);
  });

  it('sends nothing to an address the rules do not allow, and fails with the rule', async () => {
    const { sent, fetch } = recording();
    const within = fetchWithin(fetch, () => rule);

    await expect(within('https://elsewhere.example.org/mcp')).rejects.toMatchObject({ _tag: 'host_refused', rule });
    expect(sent).toEqual([]);
  });
});
