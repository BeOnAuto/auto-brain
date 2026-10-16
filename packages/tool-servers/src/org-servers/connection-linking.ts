import type { FetchLike } from '@modelcontextprotocol/client';
import { Result } from 'effect';

import { serverFailed } from '../access/server-listing.ts';
import { secretsOfServer } from '../bounds/secrets.ts';
import type { LinkOptions } from '../connections/link-openers.ts';
import { serverLink } from '../connections/server-links.ts';
import type { Describing, LinkedServerSettings } from '../openapi/described-api.ts';
import type { ConnectionServer, ConnectionSettings } from './connection-source.ts';
import { fetchWithin } from './fetch-within.ts';
import type { Linked, Unusable } from './org-servers.ts';

export interface ConnectionLinking {
  readonly options: LinkOptions;
  readonly reportLeftOut: Describing['reportLeftOut'];
}

interface Describe {
  readonly server: ConnectionServer;
  readonly fetch: FetchLike;
  readonly linking: ConnectionLinking;
}

type Described = { readonly settings: LinkedServerSettings } | { readonly refused: Unusable };

async function describedConnection(
  settings: ConnectionSettings,
  { server, fetch, linking }: Describe,
): Promise<Described> {
  if (settings.type === 'mcp') {
    return { settings };
  }
  const { describedApi } = await import('../openapi/api-description.ts');
  const described = await describedApi(settings, { fetch, reportLeftOut: linking.reportLeftOut });
  if (Result.isFailure(described)) {
    const message = described.failure.map(({ detail }) => detail).join('; ');
    return { refused: serverFailed({ settings }, { kind: 'refused', message }, linking.options.secrets) };
  }
  const refusal = server.reaches(described.success.api.baseUrl);
  return refusal === undefined
    ? { settings: described.success }
    : { refused: { because: 'connection_not_allowed', detail: refusal } };
}

export async function connectionLinkOf(
  id: string,
  server: ConnectionServer,
  linking: ConnectionLinking,
): Promise<Linked> {
  const fetch = fetchWithin(linking.options.fetch, server.reaches);
  const settings: ConnectionSettings = { ...server.settings, connection: id };
  linking.options.secrets.keep(secretsOfServer(settings));
  const described = await describedConnection(settings, { server, fetch, linking });
  return 'refused' in described ? described : { link: serverLink(described.settings, { ...linking.options, fetch }) };
}
