import type { Issue } from '@on.auto/operations';
import { isPinnableUrl } from '@on.auto/tool-servers';

import type { ConnectionEntry, ConnectionKind } from '../registry/connection-entry.ts';
import type { Credential, Placed } from '../registry/credential.ts';

const headerName = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u;

function issue(pointer: string, detail: string): readonly Issue[] {
  return [{ pointer, detail }];
}

function namedAlready(names: Readonly<Record<string, string>> | undefined, name: string): boolean {
  return Object.keys(names ?? {}).some((given) => given.toLowerCase() === name.toLowerCase());
}

function headerIssues(header: string, entry: ConnectionEntry): readonly Issue[] {
  if (!headerName.test(header)) {
    return issue('/credential/placed/header', 'Expected a header name');
  }
  return namedAlready(entry.headers, header)
    ? issue('/credential/placed/header', 'The entry sends this header already, so the credential cannot go in it')
    : [];
}

function placedIssues(placed: Placed, kind: ConnectionKind, entry: ConnectionEntry): readonly Issue[] {
  if ('header' in placed) {
    return headerIssues(placed.header, entry);
  }
  if (kind === 'mcp') {
    return issue(
      '/credential/placed',
      'Expected a header for an mcp connection: a query parameter or a security scheme is an HTTP API’s',
    );
  }
  return 'query' in placed && namedAlready(entry.query_params, placed.query)
    ? issue(
        '/credential/placed/query',
        'The entry sends this query parameter already, so the credential cannot go in it',
      )
    : [];
}

export function credentialIssuesOf(
  credential: Credential,
  kind: ConnectionKind,
  entry: ConnectionEntry,
): readonly Issue[] {
  if (credential.kind === 'secret') {
    return placedIssues(credential.placed, kind, entry);
  }
  if (credential.kind === 'client_credentials') {
    return isPinnableUrl(credential.issuer)
      ? []
      : issue('/credential/issuer', 'Expected an https URL, or an http URL on a loopback address');
  }
  return credential.kind === 'authorization'
    ? issue(
        '/credential/kind',
        'The authorization credential, a consent the person gives the server, is not available yet; give a secret or client credentials instead',
      )
    : [];
}
