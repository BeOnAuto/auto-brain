import { allPermissions, defineHttpOperation } from '@on.auto/operations';
import { Effect, Schema } from 'effect';

import { tokenSha256Of } from '../links/link-token.ts';
import { ConnectionIdField, TokenField } from '../operations/connection-fields.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { actedNow, loadRegistry, recordInRegistry } from '../operations/registry-access.ts';
import { ConnectionSchema } from '../registry/connection.ts';
import { linkedConnectionOf } from '../registry/registry-lookup.ts';

const LinkSchema = Schema.Struct({ id: ConnectionIdField, token: TokenField });

const answeringTheRecord = { kind: 'json', outputSchema: ConnectionSchema } as const;

export const readLink = defineHttpOperation('org', 'query', {
  name: 'read_link',
  title: 'Read link',
  description: [
    "Reads the connection an open link names, so Studio's page can show what the person is asked to approve.",
    'A link is open for ten minutes from when add_connection gave it, until the connection is approved.',
    'A token that is unknown, used up or expired is answered as not found.',
  ].join(' '),
  route: { method: 'GET', path: '/connections/{id}/link/{token}' },
  body: { kind: 'none' },
  permittedBy: allPermissions,
  inputSchema: LinkSchema,
  answer: answeringTheRecord,
  reasons: ['not_found'],
  handle: Effect.fnUntraced(function* ({ id, token }) {
    const registry = yield* loadRegistry;
    const use = { connection: id, token_sha256: tokenSha256Of(token), bindsPerson: false };
    const kept = yield* Effect.fromResult(linkedConnectionOf(registry, use, yield* actedNow)).pipe(
      Effect.catchTag('forbidden', Effect.die),
    );
    return kept.connection;
  }),
});

export function defineApprove({ signIn }: Pick<ConnectionServices, 'signIn'>) {
  return defineHttpOperation('org', 'command', {
    name: 'approve',
    title: 'Approve connection',
    description: [
      'Approves a connection that takes no credential to give, one of the credential none or reference, through its open link, and answers it connected.',
      'On a runtime that signs people in, only the person who added the connection may approve it.',
      'A connection that takes a secret or client credentials is approved by give_credential instead.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/approve' },
    body: { kind: 'json' },
    permittedBy: allPermissions,
    inputSchema: LinkSchema,
    answer: answeringTheRecord,
    reasons: ['not_found', 'forbidden', 'conflict'],
    handle: ({ id, token }) =>
      Effect.map(
        recordInRegistry({ type: 'approve', connection: id, token_sha256: tokenSha256Of(token), bindsPerson: signIn }),
        ({ connection }) => connection,
      ),
  });
}
