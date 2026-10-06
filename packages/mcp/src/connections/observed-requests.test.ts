import { describe, expect, it } from 'vitest';

import { observations, retryAfterMsOf } from './observed-requests.ts';

const call = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'search' } };

const answeredWith = (headers: Readonly<Record<string, string>> = {}, status = 200) =>
  new Response(null, { status, headers });

describe('the requests a connection observes', () => {
  it('pairs a request sent under a marker with the HTTP answer to it', () => {
    const observed = observations('x-request-id');
    const marker = observed.mark();

    observed.noteSent(call, { onresumptiontoken: marker });
    observed.noteAnswered(JSON.stringify(call), answeredWith({ 'retry-after': '2', 'x-request-id': 'r-1' }, 429));

    expect(observed.take(marker)).toEqual({
      id: 7,
      response: { status: 429, retryAfterMs: 2000, serverRequestId: 'r-1' },
    });
    expect(observed.take(marker)).toEqual({ id: null, response: null });
    expect(observed.lastRetryAfterMs()).toBe(2000);
  });

  it('keeps the id of a request no HTTP answer reached, as over stdio', () => {
    const observed = observations('com.example/request_id');
    const marker = observed.mark();

    observed.noteSent({ ...call, id: 'call-a' }, { onresumptiontoken: marker });

    expect(observed.take(marker)).toEqual({ id: 'call-a', response: null });
  });

  it('keeps nothing of a message sent without a marker, of a message that is not a request, or of an answer to what it did not keep', () => {
    const observed = observations(null);
    const marker = observed.mark();

    observed.noteSent(call, {});
    observed.noteSent({ jsonrpc: '2.0', id: 8, result: {} }, { onresumptiontoken: marker });
    observed.noteSent({ jsonrpc: '2.0', method: 'notifications/initialized' }, { onresumptiontoken: marker });
    observed.noteAnswered(null, answeredWith());
    observed.noteAnswered(JSON.stringify(call), answeredWith({ 'x-request-id': 'r-2' }));

    expect(observed.take(marker)).toEqual({ id: null, response: null });
    expect(observed.lastRetryAfterMs()).toBeNull();
  });
});

describe('Retry-After', () => {
  const now = Date.parse('2026-10-05T09:00:00.000Z');

  it('reads seconds, never below none', () => {
    expect(retryAfterMsOf('1.5', now)).toBe(1500);
    expect(retryAfterMsOf('-3', now)).toBe(0);
  });

  it('reads a date, never in the past', () => {
    expect(retryAfterMsOf('Mon, 05 Oct 2026 09:00:04 GMT', now)).toBe(4000);
    expect(retryAfterMsOf('Mon, 05 Oct 2026 08:00:00 GMT', now)).toBe(0);
  });

  it('reads nothing from what is missing, blank or neither', () => {
    expect(retryAfterMsOf(null, now)).toBeNull();
    expect(retryAfterMsOf('  ', now)).toBeNull();
    expect(retryAfterMsOf('soon', now)).toBeNull();
  });
});
