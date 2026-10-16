import { Schema } from 'effect';

import { ConnectionEntrySchema, ConnectionKindSchema } from './connection-entry.ts';
import { CredentialSchema } from './credential.ts';

const ConnectionStatusSchema = Schema.Literals(['pending', 'connected', 'broken', 'removed']);

export type ConnectionStatus = typeof ConnectionStatusSchema.Type;

export const ConnectionSchema = Schema.Struct({
  id: Schema.String.annotate({ description: 'The id of the connection, a UUIDv7' }),
  name: Schema.String.annotate({ description: 'The name a function gives the connection in server/tool' }),
  kind: ConnectionKindSchema,
  entry: ConnectionEntrySchema,
  credential: CredentialSchema,
  status: ConnectionStatusSchema.annotate({
    description: 'pending until it is approved and its credential given, connected, broken or removed',
  }),
  added_by: Schema.String.annotate({ description: 'The id of the caller who added it' }),
  added_at: Schema.String.annotate({ description: 'When it was added, in ISO 8601 UTC' }),
  connected_at: Schema.NullOr(Schema.String).annotate({ description: 'When it was connected, in ISO 8601 UTC' }),
  broken: Schema.NullOr(Schema.String).annotate({ description: 'Why it is broken, while it is' }),
}).annotate({ identifier: 'Connection', description: 'A tool server the org added, shared by its playbooks' });

export type Connection = typeof ConnectionSchema.Type;
