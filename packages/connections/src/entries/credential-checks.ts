import type { Issue } from '@on.auto/operations';

import type { ConnectionEntry, ConnectionKind } from '../registry/connection-entry.ts';
import type { Credential } from '../registry/credential.ts';

function issue(pointer: string, detail: string): readonly Issue[] {
  return [{ pointer, detail }];
}

function sentAlready(names: Readonly<Record<string, string>> | undefined, name: string | undefined): boolean {
  return Object.keys(names ?? {}).some((given) => given.toLowerCase() === name?.toLowerCase());
}

export function credentialIssuesOf(
  credential: Credential,
  kind: ConnectionKind,
  entry: ConnectionEntry,
): readonly Issue[] {
  if (credential.kind === 'authorization') {
    return issue(
      '/credential/kind',
      'The authorization credential, a consent the person gives the server, is not available yet; give a secret or client credentials instead',
    );
  }
  if (credential.in === 'header') {
    return sentAlready(entry.headers, credential.name)
      ? issue('/credential/name', 'The entry sends this header already, so the credential cannot go in it')
      : [];
  }
  if (credential.in !== undefined && kind === 'mcp') {
    return issue(
      '/credential/in',
      'Expected header for an mcp connection: a query parameter or a security scheme is an HTTP API’s',
    );
  }
  return credential.in === 'query' && sentAlready(entry.query_params, credential.name)
    ? issue('/credential/name', 'The entry sends this query parameter already, so the credential cannot go in it')
    : [];
}
