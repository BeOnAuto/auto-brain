import { contentOfText, defineHttpOperation } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

const Nothing = Schema.Record(Schema.String, Schema.Never);

const Named = Schema.Struct({ name: Schema.String });

const keepBlob = defineHttpOperation('brain', 'command', {
  name: 'keep_blob',
  title: 'Keep blob',
  description: 'Keeps a blob and answers it.',
  route: { method: 'POST', path: '/blobs/{name}' },
  body: { kind: 'octet-stream', mostBytes: 1024 },
  inputSchema: Named,
  outputSchema: Nothing,
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
  outputSchema: Nothing,
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
  outputSchema: Nothing,
  reasons: [],
  handle: ({ name }) => Effect.succeed(contentOfText(`blob ${name}`, 'text/plain')),
});

const renameBlob = defineHttpOperation('brain', 'command', {
  name: 'rename_blob',
  title: 'Rename blob',
  description: 'Renames a blob.',
  route: { method: 'POST', path: '/blobs/{name}/rename' },
  body: { kind: 'json' },
  inputSchema: Schema.Struct({ name: Schema.String, to: Schema.String }),
  outputSchema: Schema.Struct({ renamed: Schema.String }),
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
  outputSchema: Schema.Struct({ cleared: Schema.Boolean }),
  reasons: [],
  handle: () => Effect.succeed({ cleared: true }),
});

export const blobOperations = [keepBlob, keepRows, readBlob, renameBlob, clearBlobs];
