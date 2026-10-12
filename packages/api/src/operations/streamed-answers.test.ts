import { request } from 'node:http';

import { Function, Schema } from 'effect';
import { describe, expect, it, onTestFinished } from 'vitest';

import { blobOperations, endlessBlob, sourceFailure } from '../testing/blob-operations.ts';
import { exchanged, listenOnLoopback, unanswered } from '../testing/listening.ts';
import { notebookOperations } from '../testing/notebook.ts';
import { acmeAdmin, operationServer, type OperationServerOptions } from '../testing/operation-server.ts';

const asAdmin = { authorization: `Bearer ${acmeAdmin.key}` };

const failingBlobs = '/v1/orgs/acme/brains/alpha/failing-blobs';

async function listening(operations: NonNullable<OperationServerOptions['operations']>) {
  const server = await operationServer({ operations });
  const listened = await listenOnLoopback(server.handler);
  onTestFinished(() => listened.close());
  return { ...server, origin: listened.origin };
}

function listeningWithBlobs() {
  return listening([...notebookOperations, ...blobOperations]);
}

const problemOf = Schema.decodeUnknownSync(Schema.Struct({ reason: Schema.String, instance: Schema.String }));

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

describe('a streamed answer whose stream fails before its first chunk', () => {
  it('is a problem document of an incident the API reports with the request id', async () => {
    const { origin, thrown } = await listeningWithBlobs();

    const answer = await exchanged(origin, `${failingBlobs}/at-once`, { headers: asAdmin });

    const problem = problemOf(JSON.parse(answer.body));

    expect([answer.status, answer.headers['content-type'], problem.reason]).toEqual([
      500,
      'application/problem+json',
      'internal',
    ]);
    expect(thrown().map(({ incident, requestId, message }) => [`urn:uuid:${incident}`, requestId, message])).toEqual([
      [problem.instance, answer.headers['x-request-id'], sourceFailure],
    ]);
  });
});

describe('a streamed answer whose stream fails after its first chunk', () => {
  it('aborts the connection before any of the answer is sent when the stream fails as the server starts to send it, and reports the incident', async () => {
    const { origin, thrown } = await listeningWithBlobs();

    const answer = await exchanged(origin, `${failingBlobs}/part-way`, { headers: asAdmin });
    const next = await exchanged(origin, '/health', { headers: {} });

    expect(answer).toEqual(unanswered);
    expect(thrown().map(({ message }) => message)).toEqual([sourceFailure]);
    expect(thrown().map(({ requestId }) => requestId)).toEqual([expect.stringMatching(uuid)]);
    expect([next.status, next.body]).toEqual([200, '{"status":"ok"}']);
  });

  it('aborts the answer after the bytes it handed over when the stream fails later, with nothing of the failure on the wire, and reports the incident with the request id', async () => {
    const { origin, thrown } = await listeningWithBlobs();

    const answer = await exchanged(origin, `${failingBlobs}/later`, { headers: asAdmin });
    const next = await exchanged(origin, '/health', { headers: {} });

    expect([answer.status, answer.headers['content-length'], answer.body, answer.whole]).toEqual([
      200,
      '100',
      'first,',
      false,
    ]);
    expect(thrown().map(({ requestId, message }) => [requestId, message])).toEqual([
      [answer.headers['x-request-id'], sourceFailure],
    ]);
    expect([next.status, next.body]).toEqual([200, '{"status":"ok"}']);
  });
});

describe('a streamed answer the client leaves before its end', () => {
  it('cancels the stream it answers', async () => {
    const watched = endlessBlob();
    const { origin } = await listening([...notebookOperations, watched.operation]);

    const firstChunk = await new Promise<string>((resolve) => {
      const sent = request(`${origin}/v1/orgs/acme/brains/alpha/endless-blob`, { headers: asAdmin }, (response) => {
        response.setEncoding('utf8');
        response.once('data', (piece: string) => {
          sent.destroy();
          resolve(piece);
        });
      });
      sent.on('error', Function.constVoid);
      sent.end();
    });

    expect(firstChunk).toBe('first,');
    await expect(watched.cancelled).resolves.toBe(true);
  });
});
