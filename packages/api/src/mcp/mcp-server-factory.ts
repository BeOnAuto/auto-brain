import {
  settle,
  type Catalog,
  type Dispatcher,
  type DispatcherServices,
  type Outcome,
  type Registration,
} from '@beonauto/operations';
import { McpServer } from '@modelcontextprotocol/server';
import { Effect } from 'effect';

import type { RunCall } from '../operations/operation-routes.ts';
import { brainCallOf, orgCallOf, type HandedOff } from './caller-hand-off.ts';
import { brainEndpointInstructions, orgEndpointInstructions } from './instructions.ts';
import { toolDefinitionOf } from './tool-definition.ts';
import { toolResultOf } from './tool-result.ts';

export interface ServerInfo {
  readonly name: string;
  readonly version: string;
}

export interface McpServing {
  readonly catalog: Catalog;
  readonly dispatcher: Dispatcher;
  readonly runCall: RunCall;
  readonly serverInfo: ServerInfo;
}

export type McpServerFactory = (context: HandedOff) => McpServer;

const servedProtocolVersions: readonly string[] = ['2026-07-28', '2025-11-25'];

interface ToolContext {
  readonly mcpReq: { readonly signal: AbortSignal };
}

interface Tool {
  readonly registration: Registration;
  readonly dispatch: (input: unknown) => Effect.Effect<Outcome, never, DispatcherServices>;
}

function serverWithTools(
  { serverInfo, runCall }: McpServing,
  instructions: string,
  requestId: string,
  tools: readonly Tool[],
): McpServer {
  const server = new McpServer(
    { ...serverInfo },
    {
      capabilities: { tools: { listChanged: false } },
      instructions,
      supportedProtocolVersions: [...servedProtocolVersions],
    },
  );
  for (const { registration, dispatch } of tools) {
    server.registerTool(registration.name, toolDefinitionOf(registration), async (input, context: ToolContext) => {
      const call = settle(dispatch(input), context.mcpReq.signal).pipe(Effect.annotateLogs({ requestId }));
      return toolResultOf(await runCall(call), context.mcpReq.signal.aborted);
    });
  }
  return server;
}

export function orgServerFactory(serving: McpServing): McpServerFactory {
  const operations = serving.catalog.operationsIn('org');
  return (context) => {
    const { caller, org, requestId } = orgCallOf(context);
    const tools = operations.map((registration) => ({
      registration,
      dispatch: (input: unknown) =>
        serving.dispatcher.dispatchToOrg(registration, { caller, org, input, encoding: 'json' }),
    }));
    return serverWithTools(serving, orgEndpointInstructions, requestId, tools);
  };
}

export function brainServerFactory(serving: McpServing): McpServerFactory {
  const operations = serving.catalog.operationsIn('brain');
  return (context) => {
    const { caller, org, brain, requestId } = brainCallOf(context);
    const tools = operations.map((registration) => ({
      registration,
      dispatch: (input: unknown) =>
        serving.dispatcher.dispatchToBrain(registration, { caller, org, brain, input, encoding: 'json' }),
    }));
    return serverWithTools(serving, brainEndpointInstructions, requestId, tools);
  };
}
