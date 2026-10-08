import type { BrainAddress } from '@beonauto/operations';
import { Effect } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { RunTools } from '../calls/run-tools.ts';
import type { LinkOptions } from '../connections/server-links.ts';
import type { DeliveryCall, DeliveryCallEnded } from '../delivery/delivery-bounds.ts';
import type { ToolServer } from '../listing/tool-server.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import { isListedFor, type McpSettings } from '../settings/mcp-settings.ts';
import type { CallerContext, ServerMessage, ToolsNotOpened } from './caller-context.ts';

export interface ToolAccessOptions {
  readonly reportServerMessage: (report: ServerMessage) => void;
  readonly fetch?: LinkOptions['fetch'];
  readonly now?: () => number;
  readonly timing?: Timing;
}

export interface ToolAccess {
  readonly configured: boolean;
  readonly open: (
    context: CallerContext,
    references: readonly ToolReference[],
  ) => Effect.Effect<RunTools, ToolsNotOpened>;
  readonly callOnce: (call: DeliveryCall) => Effect.Effect<DeliveryCallEnded>;
  readonly listServers: (address: BrainAddress, named?: string) => Effect.Effect<readonly ToolServer[]>;
  readonly close: () => Promise<void>;
}

async function linked(settings: McpSettings, options: ToolAccessOptions): Promise<ToolAccess> {
  const { linkedAccess } = await import('./linked-access.ts');
  return linkedAccess(settings, options);
}

export function makeToolAccess(settings: McpSettings, options: ToolAccessOptions): ToolAccess {
  const loading: { access?: Promise<ToolAccess> } = {};
  const loaded = (): Promise<ToolAccess> => {
    loading.access ??= linked(settings, options);
    return loading.access;
  };
  return {
    configured: settings.servers.length > 0,
    open: (context, references) => Effect.flatMap(Effect.promise(loaded), (access) => access.open(context, references)),
    callOnce: (call) => Effect.flatMap(Effect.promise(loaded), (access) => access.callOnce(call)),
    listServers: (address, named) =>
      settings.servers.some((server) => isListedFor(server, address, named))
        ? Effect.flatMap(Effect.promise(loaded), (access) => access.listServers(address, named))
        : Effect.succeed([]),
    close: async () => {
      const access = await loading.access;
      await access?.close();
    },
  };
}
