import type { ServerEntryFields } from '@on.auto/tool-servers';
import { Option, Redacted } from 'effect';

import type { ConnectionEntry } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';

export interface GivenValue {
  readonly value: Redacted.Redacted;
  readonly algorithm: string | undefined;
}

export interface Placed {
  readonly fields: ServerEntryFields;
  readonly secrets: readonly Redacted.Redacted[];
}

type Placement = NonNullable<Credential['in']>;

type Fields = Pick<ServerEntryFields, 'headers' | 'query_params' | 'security'>;

const schemeAndCredential = /^[A-Za-z][\w!#$%&'*+.^`|~-]* +(\S.*)$/u;

function required<A>(value: A | undefined): A {
  return Option.getOrThrow(Option.fromNullishOr(value));
}

const placedIn: Readonly<Record<Placement, (entry: ConnectionEntry, name: string, value: string) => Fields>> = {
  header: ({ headers }, name, value) => ({ headers: { ...headers, [name]: value } }),
  query: ({ query_params: query }, name, value) => ({ query_params: { ...query, [name]: value } }),
  security: (_entry, name, value) => ({ security: { [name]: value } }),
};

function secretsOfAHeader(value: string): readonly string[] {
  const [, credential] = schemeAndCredential.exec(value) ?? [];
  return credential === undefined ? [value] : [value, credential];
}

function placedValue(entry: ConnectionEntry, credential: Credential, value: string): Placed {
  const placement = required(credential.in);
  const fields = placedIn[placement](entry, required(credential.name), value);
  const secrets = placement === 'header' ? secretsOfAHeader(value) : [value];
  return { fields: { ...entry, ...fields }, secrets: secrets.map((secret) => Redacted.make(secret)) };
}

function placedClientCredentials(entry: ConnectionEntry, credential: Credential, given: GivenValue): Placed {
  const value = Redacted.value(given.value);
  const secret =
    given.algorithm === undefined ? { client_secret: value } : { private_key: value, algorithm: given.algorithm };
  const scope = credential.scope === undefined ? {} : { scope: credential.scope };
  const auth = { issuer: required(credential.issuer), client_id: required(credential.client_id), ...scope, ...secret };
  return { fields: { ...entry, auth }, secrets: [given.value] };
}

export function placedCredential(
  entry: ConnectionEntry,
  credential: Credential,
  given: GivenValue | undefined,
): Placed {
  if (given === undefined) {
    return { fields: entry, secrets: [] };
  }
  return credential.kind === 'client_credentials'
    ? placedClientCredentials(entry, credential, given)
    : placedValue(entry, credential, Redacted.value(given.value));
}
