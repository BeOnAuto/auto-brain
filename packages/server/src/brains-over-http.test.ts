import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compositionRoot } from './composition-root.ts';
import { startServer, type RunningServer } from './lifecycle.ts';
import { request, type TestResponse } from './testing/http-client.ts';
import { temporaryLedger, type TemporaryLedger } from './testing/temporary-ledger.ts';

const brains = '/v1/orgs/acme/brains';

let ledger: TemporaryLedger;
let server: RunningServer;

beforeEach(async () => {
  ledger = temporaryLedger();
  server = await startServer({ HOST: '127.0.0.1', PORT: '0', LEDGER_FILE: ledger.fileName }, compositionRoot);
});

afterEach(async () => {
  await server.stop();
  ledger.remove();
});

function create(body: unknown): Promise<TestResponse> {
  return request(server.port, 'POST', brains, { body });
}

function cacheControlOf(response: TestResponse): string | null {
  return response.headers.get('cache-control');
}

describe('the brains of an org over HTTP in local mode', () => {
  it('creates a brain with 201, trimmed, active and created by the local developer', async () => {
    const created = await create({ brain: 'alpha', name: '  Alpha  ', description: 'Sales' });

    expect(created).toMatchObject({
      status: 201,
      body: { id: 'alpha', name: 'Alpha', description: 'Sales', status: 'active', created_by: 'local' },
    });
    expect(cacheControlOf(created)).toBe('no-store');
  });

  it('lists, reads, updates and retires a brain, each with 200 and no caching', async () => {
    await create({ brain: 'alpha', name: 'Alpha' });

    const listed = await request(server.port, 'GET', brains);
    const read = await request(server.port, 'GET', `${brains}/alpha`);
    const updated = await request(server.port, 'PUT', `${brains}/alpha`, {
      body: { name: 'Alpha two', description: '' },
    });
    const retired = await request(server.port, 'POST', `${brains}/alpha/retire`);
    const listedAfter = await request(server.port, 'GET', brains);
    const listedWithRetired = await request(server.port, 'GET', `${brains}?include_retired=true`);

    expect([listed, read, updated, retired].map(({ status }) => status)).toEqual([200, 200, 200, 200]);
    expect([listed, read, updated, retired].map((response) => cacheControlOf(response))).toEqual([
      'no-store',
      'no-store',
      'no-store',
      'no-store',
    ]);
    expect(listed.body).toMatchObject({ brains: [{ id: 'alpha', name: 'Alpha' }] });
    expect(read.body).toMatchObject({ id: 'alpha', status: 'active' });
    expect(updated.body).toMatchObject({ id: 'alpha', name: 'Alpha two', description: '' });
    expect(retired.body).toMatchObject({ id: 'alpha', status: 'retired' });
    expect(listedAfter.body).toEqual({ brains: [] });
    expect(listedWithRetired.body).toMatchObject({ brains: [{ id: 'alpha', status: 'retired' }] });
  });
});

describe('the rejections of the brain operations over HTTP', () => {
  it('rejects an id the org already has, even after it is retired, with 409', async () => {
    await create({ brain: 'alpha', name: 'Alpha' });
    const taken = await create({ brain: 'alpha', name: 'Again' });
    await request(server.port, 'POST', `${brains}/alpha/retire`);
    const takenWhileRetired = await create({ brain: 'alpha', name: 'Again' });

    expect([taken, takenWhileRetired]).toMatchObject([
      { status: 409, body: { reason: 'conflict' } },
      { status: 409, body: { reason: 'conflict' } },
    ]);
  });

  it('answers 404 for a brain the org does not have', async () => {
    const responses = await Promise.all([
      request(server.port, 'GET', `${brains}/nobody`),
      request(server.port, 'PUT', `${brains}/nobody`, { body: { name: 'Nobody', description: '' } }),
      request(server.port, 'POST', `${brains}/nobody/retire`),
    ]);

    expect(responses.map(({ status, body }) => ({ status, body }))).toMatchObject([
      { status: 404, body: { reason: 'not_found' } },
      { status: 404, body: { reason: 'not_found' } },
      { status: 404, body: { reason: 'not_found' } },
    ]);
  });

  it('rejects invalid input with 422, pointing at every problem', async () => {
    expect(await create({ brain: 'A', name: '', colour: 'red' })).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer: '/colour' }, { pointer: '/brain' }, { pointer: '/name' }] },
    });
  });
});

describe('a retired brain over HTTP', () => {
  it('rejects an update with 409', async () => {
    await create({ brain: 'alpha', name: 'Alpha' });
    await request(server.port, 'POST', `${brains}/alpha/retire`);

    expect(
      await request(server.port, 'PUT', `${brains}/alpha`, { body: { name: 'Back', description: '' } }),
    ).toMatchObject({
      status: 409,
      body: { reason: 'conflict', detail: 'The brain alpha is retired and can no longer change' },
    });
  });

  it('answers a repeated update and a repeated retire with 200, changing nothing', async () => {
    await create({ brain: 'alpha', name: 'Alpha' });
    const update = { body: { name: 'Alpha', description: '' } };

    const [firstUpdate, secondUpdate] = [
      await request(server.port, 'PUT', `${brains}/alpha`, update),
      await request(server.port, 'PUT', `${brains}/alpha`, update),
    ];
    const [firstRetire, secondRetire] = [
      await request(server.port, 'POST', `${brains}/alpha/retire`),
      await request(server.port, 'POST', `${brains}/alpha/retire`),
    ];

    expect([firstUpdate.status, secondUpdate.status, firstRetire.status, secondRetire.status]).toEqual([
      200, 200, 200, 200,
    ]);
    expect(secondUpdate.body).toEqual(firstUpdate.body);
    expect(secondRetire.body).toEqual(firstRetire.body);
  });
});
