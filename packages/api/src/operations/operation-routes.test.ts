import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const jsonAsAdmin = { ...asAdmin, 'content-type': 'application/json' };

const notes = '/v1/orgs/acme/brains/alpha/notes';

const firstNote = '{"name":"first","text":"hello"}';

describe('a command or a query served over HTTP', () => {
  it('answers a command with its declared success status, its output as JSON and no caching', async () => {
    const { handler } = await operationServer();

    const answer = await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body: firstNote });

    expect(answer).toMatchObject({ status: 201, body: { name: 'first', text: 'hello' } });
    expect(answer.headers.get('content-type')).toBe('application/json');
    expect(answer.headers.get('cache-control')).toBe('no-store');
  });

  it('answers a query with 200 and reads what a command wrote', async () => {
    const { handler } = await operationServer();
    await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body: firstNote });

    expect(await call(handler, notes, { headers: asAdmin })).toMatchObject({
      status: 200,
      body: { notes: [{ name: 'first', text: 'hello' }] },
    });
    expect(await call(handler, `${notes}/first`, { headers: asAdmin })).toMatchObject({ status: 200 });
  });

  it('serves an org-scoped operation under /v1/orgs/{org}', async () => {
    const { handler } = await operationServer();
    const betaLabel = '/v1/orgs/acme/brains/beta/label';
    await call(handler, betaLabel, { method: 'PUT', headers: jsonAsAdmin, body: '{"label":"first"}' });
    await call(handler, betaLabel, { method: 'PUT', headers: jsonAsAdmin, body: '{"label":"second"}' });

    expect(await call(handler, '/v1/orgs/acme/brain-labels', { headers: asAdmin })).toMatchObject({
      status: 200,
      body: { labels: [{ brain: 'beta', label: 'second' }] },
    });
  });
});

describe('the methods of an operation path', () => {
  it('include HEAD for a query', async () => {
    const { handler } = await operationServer();

    const head = await call(handler, notes, { method: 'HEAD', headers: asAdmin });

    expect({ status: head.status, text: head.text }).toEqual({ status: 200, text: '' });
  });

  it('are listed in Allow when a method no operation answers is refused with 405', async () => {
    const { handler } = await operationServer();

    const refused = await call(handler, notes, { method: 'DELETE', headers: asAdmin });

    expect(refused).toMatchObject({ status: 405, body: { reason: 'method_not_allowed' } });
    expect(refused.headers.get('allow')).toBe('GET, HEAD, POST');
  });
});

describe('a call that is refused or faults', () => {
  it('answers a declared refusal with its problem document', async () => {
    const { handler } = await operationServer();

    expect(await call(handler, `${notes}/missing`, { headers: asAdmin })).toMatchObject({
      status: 404,
      body: { reason: 'not_found', detail: 'There is no note missing' },
    });
  });

  it('carries the issues of invalid input as errors with pointers', async () => {
    const { handler } = await operationServer();
    const body = '{"name":"Bad Name"}';

    expect(await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body })).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/name' }, { pointer: '/text' }] },
    });
  });

  it('answers a conflict with 409', async () => {
    const { handler } = await operationServer();
    await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body: firstNote });

    expect(await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body: firstNote })).toMatchObject({
      status: 409,
      body: { reason: 'conflict', detail: 'A note named first exists' },
    });
  });

  it('answers a fault with a 500 problem that carries only the incident id it was reported under', async () => {
    const { handler, incidents } = await operationServer();

    const answer = await call(handler, '/v1/orgs/acme/brains/alpha/broken', { headers: asAdmin });

    expect(answer).toMatchObject({ status: 500, body: { reason: 'internal', incident: incidents()[0]?.id } });
    expect(answer.text).not.toContain('hunter2');
  });
});

describe('a call that cannot run', () => {
  it('answers 503 once the runtime is disposed', async () => {
    const { handler, runner } = await operationServer();
    await runner.dispose();

    expect(await call(handler, notes, { headers: asAdmin })).toMatchObject({
      status: 503,
      body: { reason: 'unavailable', type: 'https://on.auto/problems/unavailable' },
    });
  });

  it('is stopped when the client goes away, and reports no incident', async () => {
    const { handler, incidents } = await operationServer();
    const request = new Request('http://localhost/v1/orgs/acme/brains/alpha/waiting', {
      headers: asAdmin,
      signal: AbortSignal.timeout(50),
    });

    const answer = await handler.fetch(request);

    expect(answer.status).toBe(503);
    expect(incidents()).toEqual([]);
  });
});
