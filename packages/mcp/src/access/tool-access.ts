import { Effect } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { RunTools } from '../calls/run-tools.ts';
import type { LinkOptions } from '../connections/server-links.ts';
import type { CalledOnce, DeliveryCall } from '../delivery/delivery-bounds.ts';
import type { ToolServer } from '../listing/tool-server.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import {
  brainsServedBy,
  isListedFor,
  type McpSettings,
  type ServersScope,
  type ServerToolLists,
} from '../settings/mcp-settings.ts';
import type { CallerContext, ServerMessage, ToolsNotOpened } from './caller-context.ts';
import { namingOf, startsOf, type NamingCheck, type StartOf } from './entry-reads.ts';

export interface ToolAccessOptions {
  readonly reportServerMessage: (report: ServerMessage) => void;
  readonly reportUntestable: (server: string) => void;
  readonly fetch?: LinkOptions['fetch'];
  readonly now?: () => number;
  readonly timing?: Timing;
}

export interface ToolAccess {
  readonly configured: boolean;
  readonly testing: readonly ServerToolLists[];
  readonly open: (
    context: CallerContext,
    references: readonly ToolReference[],
  ) => Effect.Effect<RunTools, ToolsNotOpened>;
  readonly named: NamingCheck;
  readonly startOf: StartOf;
  readonly callOnce: (call: DeliveryCall) => Effect.Effect<CalledOnce>;
  readonly listServers: (scope: ServersScope, named?: string) => Effect.Effect<readonly ToolServer[]>;
  readonly brainsServedBy: (server: string) => readonly string[];
  readonly close: () => Promise<void>;
}

export type LinkedAccess = Omit<ToolAccess, 'brainsServedBy' | 'named' | 'startOf'>;

async function linked(settings: McpSettings, options: ToolAccessOptions): Promise<LinkedAccess> {
  const { linkedAccess } = await import('./linked-access.ts');
  return linkedAccess(settings, options);
}

export function makeToolAccess(settings: McpSettings, options: ToolAccessOptions): ToolAccess {
  const loading: { access?: Promise<LinkedAccess> } = {};
  const loaded = (): Promise<LinkedAccess> => {
    loading.access ??= linked(settings, options);
    return loading.access;
  };
  return {
    configured: settings.servers.length > 0,
    testing: settings.servers,
    open: (context, references) => Effect.flatMap(Effect.promise(loaded), (access) => access.open(context, references)),
    named: namingOf(settings.servers),
    startOf: startsOf(settings.servers),
    callOnce: (call) => Effect.flatMap(Effect.promise(loaded), (access) => access.callOnce(call)),
    listServers: (scope, named) =>
      settings.servers.some((server) => isListedFor(server, scope, named))
        ? Effect.flatMap(Effect.promise(loaded), (access) => access.listServers(scope, named))
        : Effect.succeed([]),
    brainsServedBy: (server) => brainsServedBy(settings.servers, server),
    close: async () => {
      const access = await loading.access;
      await access?.close();
    },
  };
}
