import { once } from 'node:events';
import { createServer } from 'node:http';

import { Result, Schema } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';

import { issuerRequestsOverTheNetwork, jsonAt } from './issuer-requests.ts';

const portOf = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }));

const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end('{"issuer":"https://login.example"}');
});

afterEach(() => {
  server.close();
});

describe('the requests to an issuer over the network', () => {
  it('fetch the document at an address with the fetch of the platform, within its bound', async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = portOf(server.address());

    expect(await jsonAt(issuerRequestsOverTheNetwork, `http://127.0.0.1:${port}/`, 64)).toEqual(
      Result.succeed({ issuer: 'https://login.example' }),
    );
    expect(Math.abs(issuerRequestsOverTheNetwork.now() - Date.now())).toBeLessThan(1000);
  });
});
