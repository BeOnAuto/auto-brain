import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const jsonAsAdmin = { ...asAdmin, 'content-type': 'application/json' };

const notes = '/v1/orgs/acme/brains/alpha/notes';

const betaLabel = '/v1/orgs/acme/brains/beta/label';

describe('the input of a GET operation', () => {
  it('comes from the query string, decoded from strings', async () => {
    const { handler } = await operationServer();

    expect(await call(handler, `${notes}?limit=1`, { headers: asAdmin })).toMatchObject({ status: 200 });
  });

  it.each([
    ['a value the schema cannot decode', `${notes}?limit=many`, '/limit'],
    ['an unknown field', `${notes}?colour=red`, '/colour'],
    ['a field named __proto__', `${notes}?__proto__=x`, '/__proto__'],
  ])('is rejected with 422 for %s, pointing at it', async (_case, path, pointer) => {
    const { handler } = await operationServer();

    expect(await call(handler, path, { headers: asAdmin })).toMatchObject({
      status: 422,
      body: { reason: 'invalid_input', errors: [{ pointer }] },
    });
  });

  it.each([
    ['in the query string twice', `${notes}?limit=1&limit=2`, 'limit'],
    ['in the path and the query string', `${notes}/first?name=other`, 'name'],
  ])('is rejected as a bad request for a field given %s', async (_case, path, field) => {
    const { handler } = await operationServer();

    expect(await call(handler, path, { headers: asAdmin })).toMatchObject({
      status: 400,
      body: { reason: 'bad_request', detail: `The field ${field} is given in more than one place` },
    });
  });
});

describe('the input of a POST or PUT operation', () => {
  it('merges the path parameters with the JSON body', async () => {
    const { handler } = await operationServer();

    expect(
      await call(handler, betaLabel, { method: 'PUT', headers: jsonAsAdmin, body: '{"label":"b"}' }),
    ).toMatchObject({
      status: 200,
      body: { brain: 'beta', label: 'b' },
    });
  });

  it('rejects a field given in the path and in the body as a bad request', async () => {
    const { handler } = await operationServer();
    const body = '{"brain":"alpha","label":"b"}';

    expect(await call(handler, betaLabel, { method: 'PUT', headers: jsonAsAdmin, body })).toMatchObject({
      status: 400,
      body: { reason: 'bad_request', detail: 'The field brain is given in more than one place' },
    });
  });

  it.each([
    ['POST', `${notes}?name=first`, '{"name":"first","text":"t"}'],
    ['PUT', `${betaLabel}?label=b`, '{"label":"b"}'],
    ['PUT', `${betaLabel}?unrelated=1`, '{"label":"b"}'],
  ])('rejects any query parameter on %s %s as a bad request', async (method, path, body) => {
    const { handler } = await operationServer();

    expect(await call(handler, path, { method, headers: jsonAsAdmin, body })).toMatchObject({
      status: 400,
      body: { reason: 'bad_request', detail: 'A command takes no query parameters; send its input in the JSON body' },
    });
  });

  it('is {} when the body is empty, whatever the content type', async () => {
    const { handler } = await operationServer();

    expect(await call(handler, notes, { method: 'POST', headers: asAdmin })).toMatchObject({
      status: 422,
      body: { errors: [{ pointer: '/name' }, { pointer: '/text' }] },
    });
  });
});
