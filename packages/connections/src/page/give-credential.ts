import { allPermissions, defineHttpOperation, InvalidInput, type Conflict } from '@on.auto/operations';
import { Effect, Redacted, Result, Schema } from 'effect';

import { tokenSha256Of } from '../links/link-token.ts';
import { ConnectionIdField, TokenField } from '../operations/connection-fields.ts';
import type { ConnectionServices } from '../operations/connection-services.ts';
import { actedNow, loadRegistry, recordInRegistry } from '../operations/registry-access.ts';
import { ConnectionSchema } from '../registry/connection.ts';
import type { Credential } from '../registry/credential.ts';
import { takesNoCredential } from '../registry/registry-decisions.ts';
import { linkedConnectionOf } from '../registry/registry-lookup.ts';

const SecretValue = Schema.String.check(Schema.isMinLength(1));

const GivingSchema = Schema.Struct({
  id: ConnectionIdField,
  token: TokenField,
  value: Schema.optionalKey(SecretValue.annotate({ description: 'The secret, for a credential of the kind secret' })),
  client_secret: Schema.optionalKey(SecretValue.annotate({ description: 'The client secret of client credentials' })),
  private_key: Schema.optionalKey(
    SecretValue.annotate({
      description: 'The private key in PEM that signs the client assertion of client credentials',
    }),
  ),
  algorithm: Schema.optionalKey(
    Schema.String.annotate({ description: 'The signing algorithm of private_key, such as RS256 or ES256' }),
  ),
});

type Giving = typeof GivingSchema.Type;

interface Recorded {
  readonly algorithm?: string;
  readonly ends_with?: string;
}

interface Given {
  readonly pointer: string;
  readonly value: string;
  readonly recorded: Recorded;
}

const charactersShown = 4;

const fewestCharactersToShowAny = 12;

function endingOf(value: string): Recorded {
  return value.length < fewestCharactersToShowAny ? {} : { ends_with: value.slice(-charactersShown) };
}

function refused(pointer: string, detail: string): InvalidInput {
  return new InvalidInput({ detail: 'The credential cannot be taken as it is given', issues: [{ pointer, detail }] });
}

function secretOf({ value, client_secret, private_key, algorithm }: Giving): Result.Result<Given, InvalidInput> {
  return value !== undefined && [client_secret, private_key, algorithm].every((field) => field === undefined)
    ? Result.succeed({ pointer: '/value', value, recorded: endingOf(value) })
    : Result.fail(refused('', 'Expected value alone, the secret of a credential of the kind secret'));
}

function clientCredentialsOf(giving: Giving): Result.Result<Given, InvalidInput> {
  const { value, client_secret: clientSecret, private_key: privateKey, algorithm } = giving;
  if (value === undefined && clientSecret !== undefined && privateKey === undefined && algorithm === undefined) {
    return Result.succeed({ pointer: '/client_secret', value: clientSecret, recorded: endingOf(clientSecret) });
  }
  return value === undefined && clientSecret === undefined && privateKey !== undefined && algorithm !== undefined
    ? Result.succeed({ pointer: '/private_key', value: privateKey, recorded: { algorithm } })
    : Result.fail(refused('', 'Expected client_secret, or private_key with its algorithm, one of the two'));
}

function givenOf(name: string, credential: Credential, giving: Giving): Result.Result<Given, InvalidInput | Conflict> {
  if (credential.kind === 'secret') {
    return secretOf(giving);
  }
  return credential.kind === 'client_credentials' ? clientCredentialsOf(giving) : Result.fail(takesNoCredential(name));
}

export function defineGiveCredential({
  secrets,
  bindsPerson,
}: Pick<ConnectionServices, 'secrets'> & { readonly bindsPerson: boolean }) {
  return defineHttpOperation('org', 'command', {
    name: 'give_credential',
    title: 'Give credential',
    description: [
      'Gives the credential of a connection through its open link, which approves the connection and uses the link up, and answers it connected.',
      'The runtime keeps the value sealed in its secret store, and no answer, record or history of the org ever holds it, only the last four characters of a secret or client secret of twelve or more.',
      'On a runtime that signs people in, only the person who added the connection may give it.',
    ].join(' '),
    route: { method: 'POST', path: '/connections/{id}/credential' },
    body: { kind: 'json' },
    permittedBy: allPermissions,
    inputSchema: GivingSchema,
    answer: { kind: 'json', outputSchema: ConnectionSchema },
    reasons: ['not_found', 'forbidden', 'conflict', 'invalid_input'],
    handle: Effect.fnUntraced(function* (giving) {
      const use = { connection: giving.id, token_sha256: tokenSha256Of(giving.token), bindsPerson };
      const kept = yield* Effect.fromResult(linkedConnectionOf(yield* loadRegistry, use, yield* actedNow));
      const given = yield* Effect.fromResult(givenOf(kept.connection.name, kept.connection.credential, giving));
      const secretId = yield* secrets
        .keep(Redacted.make(given.value))
        .pipe(Effect.mapError(({ detail }) => refused(given.pointer, detail)));
      const connected = yield* recordInRegistry({ type: 'give', ...use, secret_id: secretId, ...given.recorded }).pipe(
        Effect.tapError(() => secrets.forget(secretId)),
      );
      return connected.connection;
    }),
  });
}
