import { on, once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttp2Server, Http2ServerResponse } from 'node:http2';
import { createServer } from 'node:net';

import { Schema } from 'effect';
import { describe, expect, inject, it, onTestFinished } from 'vitest';

import { tcpPort } from '../lifecycle.ts';
import { freePort } from '../testing/workflow-process.ts';
import { whatAnswersOn } from './temporal-answer.ts';

const responseOf = Schema.decodeUnknownSync(Schema.instanceOf(Http2ServerResponse));

interface Reply {
  writeHead(status: number, headers: Readonly<Record<string, string>>): unknown;
  addTrailers(trailers: Readonly<Record<string, string>>): void;
  end(body: string): unknown;
}

type Respond = (response: Reply) => void;

async function http2Answering(respond: Respond): Promise<string> {
  const server = createHttp2Server().listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.close();
  });
  void (async () => {
    for await (const [, response] of on(server, 'request', { close: ['close'] })) {
      respond(responseOf(response));
    }
  })();
  return `127.0.0.1:${tcpPort(server.address())}`;
}

const grpcAnswer: Respond = (response) => {
  response.writeHead(200, { 'content-type': 'application/grpc' });
  response.addTrailers({ 'grpc-status': '0' });
  response.end('\u0000\u0000\u0000\u0000\u0000');
};

const grpcUnimplemented: Respond = (response) => {
  response.writeHead(200, { 'content-type': 'application/grpc', 'grpc-status': '12' });
  response.end('');
};

const plainAnswer: Respond = (response) => {
  response.writeHead(200, { 'content-type': 'text/plain' });
  response.end('hello');
};

async function http1Answering(): Promise<string> {
  const server = createHttpServer((_request, response) => {
    response.end('hello');
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.close();
  });
  return `127.0.0.1:${tcpPort(server.address())}`;
}

async function silentListener(): Promise<string> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  onTestFinished(() => {
    server.close();
  });
  return `127.0.0.1:${tcpPort(server.address())}`;
}

describe('what answers on a port', () => {
  it('recognises the Temporal dev server by its answer to GetSystemInfo', async () => {
    await expect(whatAnswersOn(inject('temporalAddress'))).resolves.toBe('Temporal');
  });

  it('accepts any gRPC server that answers GetSystemInfo with status 0', async () => {
    await expect(whatAnswersOn(await http2Answering(grpcAnswer))).resolves.toBe('Temporal');
  });

  it('finds nothing on a port that refuses connections', async () => {
    await expect(whatAnswersOn(`127.0.0.1:${await freePort()}`)).resolves.toBe('nothing');
  });

  it.each([
    ['an HTTP/1 server', http1Answering],
    ['a gRPC server without GetSystemInfo', () => http2Answering(grpcUnimplemented)],
    ['an HTTP/2 server that does not speak gRPC', () => http2Answering(plainAnswer)],
  ])('finds something else when %s listens', async (_kind, listening) => {
    await expect(whatAnswersOn(await listening())).resolves.toBe('something else');
  });

  it('finds something else when a listener accepts the connection and never answers', async () => {
    await expect(whatAnswersOn(await silentListener())).resolves.toBe('something else');
  });
});
