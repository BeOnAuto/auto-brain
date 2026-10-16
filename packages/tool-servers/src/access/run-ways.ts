import type { PlaybookAddress } from '@on.auto/operations';
import { Array as Arr, Effect, Option } from 'effect';

import type { RunTools } from '../calls/run-tools.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { notOfferedOnce } from '../one-call/called-once.ts';
import type { CallOnce } from '../one-call/one-call.ts';
import type { OrgAccess } from '../org-servers/org-access.ts';
import { linksOf, type OrgServer } from '../org-servers/org-servers.ts';
import type { CallerContext, ToolsNotOpened } from './caller-context.ts';
import { ToolNotOffered } from './tool-not-offered.ts';

export type NamingCheck = (
  address: PlaybookAddress,
  references: readonly ToolReference[],
) => Effect.Effect<void, ToolNotOffered>;

export interface RunWays {
  readonly open: (
    context: CallerContext,
    references: readonly ToolReference[],
  ) => Effect.Effect<RunTools, ToolsNotOpened>;
  readonly named: NamingCheck;
  readonly callOnce: CallOnce;
}

async function firstUnready(servers: readonly OrgServer[]): Promise<ToolNotOffered | undefined> {
  const [unready] = (await Promise.all(servers.map((server) => server.checked()))).flat();
  return unready === undefined ? undefined : new ToolNotOffered(unready);
}

export function runWaysOf(access: OrgAccess): RunWays {
  return {
    open: (context, references) =>
      Effect.gen(function* () {
        const servers = yield* access.namedServers(context, references);
        const linked = yield* Effect.promise(() => Promise.all(servers.map((server) => server.linked())));
        const links = yield* linksOf(linked);
        const linkedAccess = yield* Effect.promise(access.loaded);
        return yield* linkedAccess.open({ context, references, links });
      }),
    named: (address, references) =>
      Effect.gen(function* () {
        const servers = yield* access.namedServers(address, references);
        const unready = yield* Effect.promise(() => firstUnready(servers));
        if (unready !== undefined) {
          yield* Effect.fail(unready);
        }
      }),
    callOnce: (call, runCall) =>
      Effect.matchEffect(access.namedServers(call, [call.reference]), {
        onFailure: (refusal: Pick<ToolNotOffered, 'because' | 'detail'>) => Effect.succeed(notOfferedOnce(refusal)),
        onSuccess: (servers) =>
          Effect.flatMap(Effect.promise(access.loaded), (linkedAccess) =>
            linkedAccess.callOnce(call, Option.getOrThrow(Arr.head(servers)), runCall),
          ),
      }),
  };
}
