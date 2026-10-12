import { setTimeout as delay } from 'node:timers/promises';

import { contentOfText, defineHttpOperation, type StreamedBytes } from '@beonauto/operations';
import { Effect, Function, Schema } from 'effect';

const Nothing = Schema.Record(Schema.String, Schema.Never);

const Named = Schema.Struct({ name: Schema.String });

export const sourceFailure = 'The store failed at /var/lib/ledger/blobs, which no client may read';

const keepBlob = defineHttpOperation('brain', 'command', {
  name: 'keep_blob',
  title: 'Keep blob',
  description: 'Keeps a blob and answers it.',
  route: { method: 'POST', path: '/blobs/{name}' },
  body: { kind: 'octet-stream', mostBytes: 1024 },
  inputSchema: Named,
  answer: { kind: 'stream', mediaType: 'application/octet-stream' },
  reasons: [],
  handle: (_input, body) => Effect.succeed(body),
});

const keepRows = defineHttpOperation('brain', 'command', {
  name: 'keep_rows',
  title: 'Keep rows',
  description: 'Keeps rows and answers them.',
  route: { method: 'PUT', path: '/rows/{name}' },
  body: { kind: 'csv', mostBytes: 1024 },
  inputSchema: Named,
  answer: { kind: 'stream', mediaType: 'text/csv' },
  reasons: [],
  handle: (_input, body) => Effect.succeed(body),
});

const readBlob = defineHttpOperation('brain', 'query', {
  name: 'read_blob',
  title: 'Read blob',
  description: 'Reads a blob.',
  route: { method: 'GET', path: '/blobs/{name}' },
  body: { kind: 'none' },
  inputSchema: Named,
  answer: { kind: 'stream', mediaType: 'text/plain' },
  reasons: [],
  handle: ({ name }) => Effect.succeed(contentOfText(`blob ${name}`, 'application/octet-stream')),
});

const FailingAt = Schema.Struct({ when: Schema.Literals(['at-once', 'part-way', 'later']) });

function failing(when: (typeof FailingAt)['Type']['when']): StreamedBytes {
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      if (when !== 'at-once') {
        controller.enqueue(new TextEncoder().encode('first,'));
      }
    },
    pull: async (controller) => {
      if (when === 'later') {
        await delay(20);
      }
      controller.error(new Error(sourceFailure));
    },
  });
  return { stream, bytes: 100 };
}

const readFailingBlob = defineHttpOperation('brain', 'query', {
  name: 'read_failing_blob',
  title: 'Read failing blob',
  description: 'Reads a blob whose store fails.',
  route: { method: 'GET', path: '/failing-blobs/{when}' },
  body: { kind: 'none' },
  inputSchema: FailingAt,
  answer: { kind: 'stream', mediaType: 'text/plain' },
  reasons: [],
  handle: ({ when }) => Effect.sync(() => failing(when)),
});

export function endlessBlob() {
  const { promise: cancelled, resolve } = Promise.withResolvers<boolean>();
  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode('first,'));
    },
    pull: () => cancelled.then(Function.constVoid),
    cancel: () => {
      resolve(true);
    },
  });
  const operation = defineHttpOperation('brain', 'query', {
    name: 'read_endless_blob',
    title: 'Read endless blob',
    description: 'Reads a blob that never ends.',
    route: { method: 'GET', path: '/endless-blob' },
    body: { kind: 'none' },
    inputSchema: Nothing,
    answer: { kind: 'stream', mediaType: 'text/plain' },
    reasons: [],
    handle: () => Effect.succeed({ stream, bytes: 1_000_000 }),
  });
  return { operation, cancelled };
}

const renameBlob = defineHttpOperation('brain', 'command', {
  name: 'rename_blob',
  title: 'Rename blob',
  description: 'Renames a blob.',
  route: { method: 'POST', path: '/blobs/{name}/rename' },
  body: { kind: 'json' },
  inputSchema: Schema.Struct({ name: Schema.String, to: Schema.String }),
  answer: { kind: 'json', outputSchema: Schema.Struct({ renamed: Schema.String }) },
  reasons: [],
  handle: ({ to }) => Effect.succeed({ renamed: to }),
});

const clearBlobs = defineHttpOperation('brain', 'command', {
  name: 'clear_blobs',
  title: 'Clear blobs',
  description: 'Clears the blobs.',
  route: { method: 'POST', path: '/blobs/clear' },
  body: { kind: 'none' },
  inputSchema: Nothing,
  answer: { kind: 'json', outputSchema: Schema.Struct({ cleared: Schema.Boolean }) },
  reasons: [],
  handle: () => Effect.succeed({ cleared: true }),
});

export const blobOperations = [keepBlob, keepRows, readBlob, readFailingBlob, renameBlob, clearBlobs];
