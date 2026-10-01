import {
  settle,
  type Catalog,
  type Dispatcher,
  type DispatcherServices,
  type Outcome,
  type Registration,
} from '@beonauto/operations';
import { McpServer, type CallToolResult } from '@modelcontextprotocol/server';
import { Effect } from 'effect';

import type { RunCall } from '../operations/operation-routes.ts';
import type { ReportThrown } from '../problem/error-boundary.ts';
import { brainCallOf, orgCallOf, type HandedOff } from './caller-hand-off.ts';
import { brainEndpointInstructions, orgEndpointInstructions } from './instructions.ts';
import { toolDefinitionOf } from './tool-definition.ts';
import { problemResultOf, toolResultOf } from './tool-result.ts';

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

export interface ToolServing extends McpServing {
  readonly reportThrown: ReportThrown;
}

export type McpServerFactory = (context: HandedOff) => McpServer;

interface ToolContext {
  readonly mcpReq: { readonly signal: AbortSignal };
}

type Dispatch = (input: unknown) => Effect.Effect<Outcome, never, DispatcherServices>;

interface Tool {
  readonly registration: Registration;
  readonly dispatch: Dispatch;
}

function callbackFor(
  { runCall, reportThrown }: ToolServing,
  requestId: string,
  dispatch: Dispatch,
): (input: unknown, context: ToolContext) => Promise<CallToolResult> {
  return async (input, { mcpReq: { signal } }) => {
    const call = settle(dispatch(input), signal).pipe(Effect.annotateLogs({ requestId }));
    try {
      return toolResultOf(await runCall(call), signal.aborted);
    } catch (thrown) {
      return problemResultOf(reportThrown(thrown, requestId));
    }
  };
}

function serverWithTools(
  serving: ToolServing,
  instructions: string,
  requestId: string,
  tools: readonly Tool[],
): McpServer {
  const server = new McpServer(
    { ...serving.serverInfo },
    { capabilities: { tools: { listChanged: false } }, instructions },
  );
  for (const { registration, dispatch } of tools) {
    server.registerTool(registration.name, toolDefinitionOf(registration), callbackFor(serving, requestId, dispatch));
  }
  return server;
}

export function orgServerFactory(serving: ToolServing): McpServerFactory {
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

export function brainServerFactory(serving: ToolServing): McpServerFactory {
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
