import { Effect } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { RunTools } from '../calls/run-tools.ts';
import type { LinkOptions } from '../connections/server-links.ts';
import type { DeliveryCall, DeliveryCallEnded } from '../delivery/delivery-bounds.ts';
import type { ToolServer } from '../listing/tool-server.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { brainsServedBy, isListedFor, type McpSettings, type ServersScope } from '../settings/mcp-settings.ts';
import type { CallerContext, ServerMessage, ToolsNotOpened } from './caller-context.ts';

export interface ToolAccessOptions {
  readonly reportServerMessage: (report: ServerMessage) => void;
  readonly reportUntestable: (server: string) => void;
  readonly fetch?: LinkOptions['fetch'];
  readonly now?: () => number;
  readonly timing?: Timing;
}

export interface ToolAccess {
  readonly configured: boolean;
  readonly testing: Pick<McpSettings, 'allowed' | 'testable'>;
  readonly open: (
    context: CallerContext,
    references: readonly ToolReference[],
  ) => Effect.Effect<RunTools, ToolsNotOpened>;
  readonly callOnce: (call: DeliveryCall) => Effect.Effect<DeliveryCallEnded>;
  readonly listServers: (scope: ServersScope, named?: string) => Effect.Effect<readonly ToolServer[]>;
  readonly brainsServedBy: (server: string) => readonly string[];
  readonly close: () => Promise<void>;
}

export type LinkedAccess = Omit<ToolAccess, 'brainsServedBy'>;

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
    testing: { allowed: settings.allowed, testable: settings.testable },
    open: (context, references) => Effect.flatMap(Effect.promise(loaded), (access) => access.open(context, references)),
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
