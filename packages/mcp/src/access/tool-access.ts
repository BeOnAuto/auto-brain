import { Effect } from 'effect';

import type { Timing } from '../bounds/call-bounds.ts';
import type { RunTools } from '../calls/run-tools.ts';
import type { LinkOptions } from '../connections/server-links.ts';
import type { DeliveryCall, DeliveryCallEnded } from '../delivery/delivery-bounds.ts';
import type { ToolReference } from '../names/tool-reference.ts';
import type { McpSettings } from '../settings/mcp-settings.ts';
import type { RunContext, ServerMessage, ToolsNotOpened } from './run-context.ts';

export interface ToolAccessOptions {
  readonly reportServerMessage: (report: ServerMessage) => void;
  readonly fetch?: LinkOptions['fetch'];
  readonly now?: () => number;
  readonly timing?: Timing;
}

export interface ToolAccess {
  readonly configured: boolean;
  readonly open: (
    execution: RunContext,
    references: readonly ToolReference[],
  ) => Effect.Effect<RunTools, ToolsNotOpened>;
  readonly callOnce: (call: DeliveryCall) => Effect.Effect<DeliveryCallEnded>;
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
    open: (execution, references) =>
      Effect.flatMap(Effect.promise(loaded), (access) => access.open(execution, references)),
    callOnce: (call) => Effect.flatMap(Effect.promise(loaded), (access) => access.callOnce(call)),
    close: async () => {
      const access = await loading.access;
      await access?.close();
    },
  };
}
