import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isDeliverableUrl, outboundBounds, postedOutbound, type PostOutcome } from '../index.ts';
import { serveFakeReceiver, type FakeReceiver } from '../testing/fake-receiver.ts';

const receiver: { current?: FakeReceiver } = {};

beforeAll(async () => {
  receiver.current = await serveFakeReceiver();
});

afterAll(async () => {
  await receiver.current?.close();
});

function receiving(): FakeReceiver {
  if (receiver.current === undefined) {
    throw new Error('The receiver has not started');
  }
  return receiver.current;
}

function waitAskedBy(outcome: PostOutcome | undefined): number {
  return outcome?.kind === 'failed' ? (outcome.retryAfterMs ?? 0) : 0;
}

function posted(body = '{"hello":"world"}', headers: Readonly<Record<string, string>> = {}) {
  return postedOutbound({ url: receiving().url, headers: { 'content-type': 'application/json', ...headers }, body });
}

describe('a post that reaches its receiver', () => {
  it('sends the body and the headers once, and answers what came back', async () => {
    receiving().answerWith({ status: 200, body: '{"choice":"approve"}' });

    const outcome = await posted('{"hello":"world"}', { 'webhook-id': 'm-1' });

    expect(outcome).toEqual({ kind: 'delivered', status: 200, body: '{"choice":"approve"}', bytes: 20, cut: false });
    expect(receiving().received().at(-1)).toMatchObject({
      method: 'POST',
      path: '/requests',
      headers: { 'content-type': 'application/json', 'webhook-id': 'm-1' },
      body: '{"hello":"world"}',
    });
  });

  it('reads at most 64 KiB of what came back, and says it cut the rest', async () => {
    receiving().answerWith({ status: 202, body: 'é'.repeat(outboundBounds.responseBytes) });

    const outcome = await posted();

    expect(outcome).toMatchObject({
      kind: 'delivered',
      status: 202,
      cut: true,
      body: 'é'.repeat(outboundBounds.responseBytes / 2),
    });
  });
});

describe('a post its receiver does not take', () => {
  const answers: ReadonlyArray<readonly [number, PostOutcome]> = [
    [408, { kind: 'failed', status: 408, because: 'status' }],
    [500, { kind: 'failed', status: 500, because: 'status' }],
    [503, { kind: 'failed', status: 503, because: 'status' }],
    [404, { kind: 'refused', status: 404, because: 'status' }],
    [422, { kind: 'refused', status: 422, because: 'status' }],
  ];

  it.each(answers)('answered %i, is %j', async (status, outcome) => {
    receiving().answerWith({ status });

    expect(await posted()).toEqual(outcome);
  });

  it('is refused when its receiver redirects it, and the redirect is not followed', async () => {
    receiving().answerWith({ status: 307, headers: { location: `${receiving().url}/elsewhere` } });
    const before = receiving().received().length;

    expect(await posted()).toEqual({ kind: 'refused', status: 307, because: 'redirected' });
    expect(receiving().received()).toHaveLength(before + 1);
  });

  it('honours the wait a 429 asks for, in seconds or as a date', async () => {
    receiving().answerWith(
      { status: 429, headers: { 'retry-after': '120' } },
      { status: 429, headers: { 'retry-after': new Date(Date.now() + 90_000).toUTCString() } },
      { status: 429, headers: { 'retry-after': 'soon' } },
      { status: 429 },
    );

    const outcomes = [await posted(), await posted(), await posted(), await posted()];

    expect(outcomes[0]).toEqual({ kind: 'failed', status: 429, because: 'status', retryAfterMs: 120_000 });
    expect(outcomes[1]).toMatchObject({ kind: 'failed', status: 429 });
    expect(waitAskedBy(outcomes[1])).toBeGreaterThan(80_000);
    expect(outcomes.slice(2)).toEqual([
      { kind: 'failed', status: 429, because: 'status' },
      { kind: 'failed', status: 429, because: 'status' },
    ]);
  });
});

describe('a post that does not reach a receiver', () => {
  it('fails when the receiver takes longer than the post waits', async () => {
    receiving().answerWith({ status: 200, delayMs: 500 });

    expect(await postedOutbound({ url: receiving().url, headers: {}, body: '{}', timeoutMs: 50 })).toEqual({
      kind: 'failed',
      status: null,
      because: 'timed_out',
    });
  });

  it('fails when nothing listens, or the certificate of the receiver is not trusted', async () => {
    const untrusted = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('self signed'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }),
    });

    expect(await postedOutbound({ url: 'http://127.0.0.1:9/requests', headers: {}, body: '{}' })).toEqual({
      kind: 'failed',
      status: null,
      because: 'unreachable',
    });
    expect(
      await postedOutbound({
        url: 'https://partner.example.com/requests',
        headers: {},
        body: '{}',
        fetch: () => Promise.reject(untrusted),
      }),
    ).toEqual({ kind: 'failed', status: null, because: 'untrusted_certificate' });
  });

  it('is refused before it is sent to a URL that is not https on another host, or with a body over 240 KiB', async () => {
    expect(await postedOutbound({ url: 'http://partner.example.com/requests', headers: {}, body: '{}' })).toEqual({
      kind: 'refused',
      status: null,
      because: 'not_https',
    });
    expect(
      await postedOutbound({ url: receiving().url, headers: {}, body: 'x'.repeat(outboundBounds.requestBytes + 1) }),
    ).toEqual({ kind: 'refused', status: null, because: 'too_large' });
  });
});

describe('the fake receiver of the tests', () => {
  it('answers every post alike once it is told how, and with no content until then', async () => {
    const fresh = await serveFakeReceiver('/hooks');

    const before = await postedOutbound({ url: fresh.url, headers: {}, body: '{}' });
    fresh.answerEveryWith({ status: 503 });
    const after = [
      await postedOutbound({ url: fresh.url, headers: {}, body: '{}' }),
      await postedOutbound({ url: fresh.url, headers: {}, body: '{}' }),
    ];
    await fresh.close();

    expect(before).toEqual({ kind: 'delivered', status: 204, body: '', bytes: 0, cut: false });
    expect(after.map(({ kind }) => kind)).toEqual(['failed', 'failed']);
    expect(fresh.received().map(({ path }) => path)).toEqual(['/hooks', '/hooks', '/hooks']);
  });
});

describe('a URL a delivery may post to', () => {
  it('is https, or http on a loopback address', () => {
    expect(
      [
        'https://partner.example.com/requests',
        'http://127.0.0.1:8080/hooks',
        'http://localhost/hooks',
        'http://[::1]/hooks',
        'http://partner.example.com/requests',
        'ftp://partner.example.com/requests',
        'not a url',
      ].map((url) => isDeliverableUrl(url)),
    ).toEqual([true, true, true, true, false, false, false]);
  });
});
