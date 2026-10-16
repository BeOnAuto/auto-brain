import { PlaybookContext } from '@on.auto/operations';
import { Array as Arr, Effect, Option } from 'effect';

import type { ToolAccess } from '../access/tool-access.ts';
import type { AvailableServer, ServerTool } from '../listing/tool-server.ts';
import { notListed } from '../names/tool-naming.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { unavailableOf, unavailableServerOf } from './tool-refusals.ts';

export type ToolLookup = Pick<ToolAccess, 'named' | 'listServers'>;

export function listedTool({ tools }: AvailableServer, name: string): Option.Option<ServerTool> {
  return Option.fromNullishOr(tools.find((tool) => tool.name === name));
}

export const namedToolOf = Effect.fnUntraced(function* (access: ToolLookup, reference: ToolReference) {
  const address = yield* PlaybookContext;
  yield* Effect.mapError(access.named(address, [reference]), unavailableOf);
  const server = Option.getOrThrow(Arr.head(yield* access.listServers(address, reference.server)));
  if ('unavailable' in server) {
    return yield* Effect.fail(unavailableServerOf(server));
  }
  const found = listedTool(server, reference.tool);
  if (Option.isNone(found)) {
    return yield* Effect.fail(unavailableOf(notListed([reference])));
  }
  return found.value;
});
