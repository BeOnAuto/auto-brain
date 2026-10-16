import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Option } from 'effect';

import type { LinkedAccess } from '../access/linked-access.ts';
import type { ToolNotOffered } from '../access/tool-not-offered.ts';
import { namedLinks } from '../names/tool-naming.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { LinkedServerSettings, ToolServers } from '../openapi/described-api.ts';
import { connectionLinks } from './connection-links.ts';
import type { ConnectionSource } from './connection-source.ts';
import { namedIn, withTheFileFirst, type OrgServer } from './org-servers.ts';

export type Load = () => Promise<LinkedAccess>;

export interface OrgAccess {
  readonly loaded: Load;
  readonly serversOf: (org: string) => Effect.Effect<readonly OrgServer[]>;
  readonly namedServers: (
    address: PlaybookAddress,
    references: readonly ToolReference[],
  ) => Effect.Effect<readonly OrgServer[], ToolNotOffered>;
  readonly close: () => Promise<void>;
}

function fileServer(settings: LinkedServerSettings, loaded: Load): OrgServer {
  return {
    settings,
    checked: () => Promise.resolve([]),
    linked: async () => {
      const { fileLinks } = await loaded();
      return { link: Option.getOrThrow(Option.fromNullishOr(fileLinks.get(settings.name))) };
    },
  };
}

export function orgAccessOf(settings: ToolServers, source: ConnectionSource, loaded: Load): OrgAccess {
  const connections = connectionLinks(source, async (id, server) => (await loaded()).connectionLink(id, server));
  const files = settings.servers.map((server) => fileServer(server, loaded));
  const serversOf = (org: string): Effect.Effect<readonly OrgServer[]> =>
    Effect.map(connections.serversOf(org), (ofTheOrg) => withTheFileFirst(files, ofTheOrg));
  return {
    loaded,
    serversOf,
    namedServers: (address, references) =>
      Effect.flatMap(serversOf(address.org), (servers) =>
        Effect.fromResult(namedLinks(address, { references, links: namedIn(address.org, servers) })),
      ),
    close: connections.close,
  };
}
