import type { FetchLike } from '@modelcontextprotocol/client';
import { Result } from 'effect';

import type { LinkOptions } from '../connections/link-openers.ts';
import { serverLink } from '../connections/server-links.ts';
import type { Describing, LinkedServerSettings } from '../openapi/described-api.ts';
import type { Linking } from './connection-links.ts';
import type { ConnectionServer, ConnectionSettings } from './connection-source.ts';
import { fetchWithin } from './fetch-within.ts';
import { serverFailed } from './server-refusals.ts';

export interface ConnectionLinking {
  readonly options: LinkOptions;
  readonly reportLeftOut: Describing['reportLeftOut'];
}

interface Describe {
  readonly server: ConnectionServer;
  readonly fetch: FetchLike;
  readonly linking: ConnectionLinking;
}

type Described = { readonly settings: LinkedServerSettings } | Exclude<Linking, { readonly link: unknown }>;

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
    const { problems, readAgain } = described.failure;
    const message = problems.map(({ detail }) => detail).join('; ');
    const unusable = serverFailed({ settings }, { kind: 'refused', message }, linking.options.secrets);
    return readAgain ? { unread: unusable } : { refused: unusable };
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
): Promise<Linking> {
  const fetch = fetchWithin(linking.options.fetch, server.reaches);
  const settings: ConnectionSettings = { ...server.settings, connection: id };
  const described = await describedConnection(settings, { server, fetch, linking });
  return 'settings' in described ? { link: serverLink(described.settings, { ...linking.options, fetch }) } : described;
}
