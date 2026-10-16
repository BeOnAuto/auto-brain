import { Effect } from 'effect';

import { unavailableServer } from '../listing/server-fields.ts';
import type { ToolServer } from '../listing/tool-server.ts';
import type { Load, OrgAccess } from '../org-servers/org-access.ts';
import { byNameFileFirst, namedIn, type OrgServer } from '../org-servers/org-servers.ts';
import { isListedFor, type ServersScope } from '../settings/server-settings.ts';
import { startedOn, type RecordingParts, type StartOf } from './entry-reads.ts';

export interface ListingWays {
  readonly listServers: (scope: ServersScope, named?: string) => Effect.Effect<readonly ToolServer[]>;
  readonly startOf: StartOf;
}

async function listedOn(server: OrgServer, loaded: Load): Promise<ToolServer> {
  const linked = await server.linked();
  return 'refused' in linked
    ? unavailableServer(server.settings, linked.refused)
    : (await loaded()).listed(linked.link);
}

export function listingWaysOf(access: OrgAccess, recording: RecordingParts): ListingWays {
  return {
    listServers: (scope, named) =>
      Effect.flatMap(access.serversOf(scope.org), (servers) => {
        const asked = servers.filter((server) => isListedFor(server.settings, scope, named)).toSorted(byNameFileFirst);
        return Effect.promise(() => Promise.all(asked.map((server) => listedOn(server, access.loaded))));
      }),
    startOf: (call) =>
      Effect.flatMap(access.serversOf(call.org), (servers) => {
        const served = namedIn(call.org, servers).get(call.reference.server)?.settings;
        return Effect.promise(() => startedOn(served, call, recording));
      }),
  };
}
