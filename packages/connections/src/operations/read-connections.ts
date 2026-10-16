import { defineQuery, quoted } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { ConnectionSchema } from '../registry/connection.ts';
import { newestFirst } from '../registry/registry.ts';
import { ConnectionIdField } from './connection-fields.ts';
import { connectionStanding, connectionsListed } from './connection-words.ts';
import { foundConnection, loadRegistry } from './registry-access.ts';

export const listConnections = defineQuery('org', {
  name: 'list_connections',
  title: 'List connections',
  description: [
    'Lists the connections of the org, newest first, each with its server and whether it is pending, connected or broken.',
    'Use it to see which tool servers people added; get_connection reads one by its id.',
    '`include_removed` adds the removed ones.',
  ].join(' '),
  route: { method: 'GET', path: '/connections' },
  inputSchema: Schema.Struct({
    include_removed: Schema.optionalKey(
      Schema.Boolean.annotate({ description: 'Whether to list removed connections as well; false when left out' }),
    ),
  }),
  outputSchema: Schema.Struct({ connections: Schema.Array(ConnectionSchema) }),
  reasons: [],
  handle: Effect.fnUntraced(function* ({ include_removed: includeRemoved = false }) {
    const registry = yield* loadRegistry;
    const connections = newestFirst(registry)
      .map(({ connection }) => connection)
      .filter(({ status }) => includeRemoved || status !== 'removed');
    return { connections };
  }),
  plainLanguage: {
    task: 'list the connections',
    attempt: () => 'list the connections',
    outcome: ({ connections }) => connectionsListed(connections),
  },
});

export const getConnection = defineQuery('org', {
  name: 'get_connection',
  title: 'Get connection',
  description: [
    'Reads one connection of the org: its server, who added it and whether it is pending, connected, broken or removed.',
    'Use it to see whether the person approved a connection; list_connections finds its id.',
    '`id` is the id add_connection answered.',
  ].join(' '),
  route: { method: 'GET', path: '/connections/{id}' },
  inputSchema: Schema.Struct({ id: ConnectionIdField }),
  outputSchema: ConnectionSchema,
  reasons: ['not_found'],
  handle: ({ id }) => Effect.map(foundConnection(id), ({ connection }) => connection),
  plainLanguage: {
    task: 'look up a connection',
    attempt: ({ id }) => `look up the connection ${quoted(id)}`,
    outcome: (connection) => connectionStanding(connection),
  },
});
