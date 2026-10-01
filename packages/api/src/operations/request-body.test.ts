import { describe, expect, it } from 'vitest';

import { call } from '../testing/api-calls.ts';
import { acmeAdmin, operationServer } from '../testing/operation-server.ts';

type Headers = Readonly<Record<string, string>>;

interface ExpectedRejection {
  readonly status: number;
  readonly reason: string;
}

const asAdmin: Headers = { authorization: `Bearer ${acmeAdmin.key}` };

const jsonAsAdmin: Headers = { ...asAdmin, 'content-type': 'application/json' };

const notes = '/v1/orgs/acme/brains/alpha/notes';

const mebibyte = 1024 * 1024;

const rejectedBodies: ReadonlyArray<readonly [string, Headers, string, ExpectedRejection]> = [
  [
    'a body of another media type',
    { ...asAdmin, 'content-type': 'text/plain' },
    'name=a',
    { status: 415, reason: 'unsupported_media_type' },
  ],
  ['text that is not JSON', jsonAsAdmin, '{nope', { status: 400, reason: 'bad_request' }],
  ['a JSON array', jsonAsAdmin, '[1]', { status: 400, reason: 'bad_request' }],
  ['JSON null', jsonAsAdmin, 'null', { status: 400, reason: 'bad_request' }],
];

describe('the encoding of a body', () => {
  it('is application/json with parameters, in any letter case', async () => {
    const { handler } = await operationServer();
    const headers = { ...asAdmin, 'content-type': 'Application/JSON; charset=utf-8' };

    expect(await call(handler, notes, { method: 'POST', headers, body: '{"name":"a","text":"b"}' })).toMatchObject({
      status: 201,
    });
  });

  it.each(rejectedBodies)('rejects %s', async (_case, headers, body, { status, reason }) => {
    const { handler } = await operationServer();

    expect(await call(handler, notes, { method: 'POST', headers, body })).toMatchObject({ status, body: { reason } });
  });

  it('must be declared', async () => {
    const { handler } = await operationServer();
    const body = new TextEncoder().encode('{"name":"a","text":"b"}');

    const answer = await handler.fetch(
      new Request(`http://localhost${notes}`, { method: 'POST', headers: asAdmin, body }),
    );

    expect({ status: answer.status, body: await answer.json() }).toMatchObject({
      status: 415,
      body: { reason: 'unsupported_media_type' },
    });
  });

  it('must be UTF-8', async () => {
    const { handler } = await operationServer();
    const body = new Uint8Array([0x7b, 0xff, 0x7d]);

    const answer = await handler.fetch(
      new Request(`http://localhost${notes}`, { method: 'POST', headers: jsonAsAdmin, body }),
    );

    expect({ status: answer.status, body: await answer.json() }).toMatchObject({
      status: 400,
      body: { reason: 'bad_request', detail: 'The body could not be read as UTF-8 text' },
    });
  });
});

describe('the size of a body', () => {
  it('is rejected once it passes 1 MiB while being read, whatever length the request declares', async () => {
    const { handler } = await operationServer();
    const body = JSON.stringify({ name: 'big', text: 'x'.repeat(mebibyte) });

    expect(await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body })).toMatchObject({
      status: 413,
      body: { reason: 'payload_too_large' },
    });
  });

  it('is not read when the request declares more than 1 MiB', async () => {
    const { handler } = await operationServer();
    const headers = { ...jsonAsAdmin, 'content-length': String(mebibyte + 1) };

    expect(await call(handler, notes, { method: 'POST', headers, body: '{}' })).toMatchObject({ status: 413 });
  });

  it('may be exactly 1 MiB', async () => {
    const { handler } = await operationServer();
    const envelope = JSON.stringify({ name: 'big', text: '' });
    const body = JSON.stringify({ name: 'big', text: 'x'.repeat(mebibyte - envelope.length) });

    expect(await call(handler, notes, { method: 'POST', headers: jsonAsAdmin, body })).toMatchObject({ status: 201 });
  });
});
