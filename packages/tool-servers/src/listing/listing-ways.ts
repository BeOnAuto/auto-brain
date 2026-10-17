import type { PlaybookAddress } from '@on.auto/operations';
import { Effect, Option, type Result } from 'effect';

import type { ToolNotOffered } from '../access/tool-not-offered.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { Load, OrgAccess } from '../org-servers/org-access.ts';
import { readyAmong } from '../org-servers/org-naming.ts';
import { byNameFileFirst, type OrgServer } from '../org-servers/org-servers.ts';
import { isListedFor, type ServersScope } from '../settings/server-settings.ts';
import { unavailableServer } from './server-fields.ts';
import type { ToolServer } from './tool-server.ts';

interface LookedUp {
  readonly naming: Result.Result<void, ToolNotOffered>;
  readonly listed: Effect.Effect<ToolServer>;
}

export interface ListingWays {
  readonly listServers: (scope: ServersScope, named?: string) => Effect.Effect<readonly ToolServer[]>;
  readonly lookUp: (address: PlaybookAddress, reference: ToolReference) => Effect.Effect<LookedUp>;
}

async function listedOn(server: OrgServer, loaded: Load): Promise<ToolServer> {
  const linked = await server.linked();
  return 'refused' in linked
    ? unavailableServer(server.settings, linked.refused)
    : (await loaded()).listed(linked.link);
}

function listedAmong(servers: readonly OrgServer[], scope: ServersScope, named: string | undefined, loaded: Load) {
  const asked = servers.filter((server) => isListedFor(server.settings, scope, named)).toSorted(byNameFileFirst);
  return Effect.promise(() => Promise.all(asked.map((server) => listedOn(server, loaded))));
}

export function listingWaysOf(access: OrgAccess): ListingWays {
  return {
    listServers: (scope, named) =>
      Effect.flatMap(access.serversOf(scope.org), (servers) => listedAmong(servers, scope, named, access.loaded)),
    lookUp: (address, reference) =>
      Effect.gen(function* () {
        const servers = yield* access.serversOf(address.org);
        const naming = yield* Effect.result(readyAmong(servers, { address, references: [reference] }));
        const listed = Effect.gen(function* () {
          const [server] = yield* listedAmong(servers, address, reference.server, access.loaded);
          return Option.getOrThrow(Option.fromNullishOr(server));
        });
        return { naming, listed };
      }),
  };
}
