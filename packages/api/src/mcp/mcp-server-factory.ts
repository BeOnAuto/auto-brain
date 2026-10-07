import type { Catalog, Dispatcher, RegisteredPlainLanguage, Registration } from '@beonauto/operations';
import { McpServer } from '@modelcontextprotocol/server';
import { Effect, Result } from 'effect';

import type { RunCall } from '../operations/operation-routes.ts';
import type { ReportThrown } from '../problem/error-boundary.ts';
import { brainArgumentOf } from './brain-argument.ts';
import { brainCallOf, orgCallOf, type BrainCall, type HandedOff, type OrgCall } from './caller-hand-off.ts';
import { instructionsFor, type DefinitionType } from './instructions.ts';
import { callbackFor, type CalledTool, type Dispatch } from './tool-callback.ts';
import { toolDefinitionOf, toolDefinitionTakingBrainOf, type ToolDefinition } from './tool-definition.ts';

export interface ServerInfo {
  readonly name: string;
  readonly version: string;
}

export interface McpServing {
  readonly catalog: Catalog;
  readonly dispatcher: Dispatcher;
  readonly runCall: RunCall;
  readonly serverInfo: ServerInfo;
  readonly definitionTypes: readonly DefinitionType[];
}

export interface ToolServing extends McpServing {
  readonly reportThrown: ReportThrown;
}

export type McpServerFactory = (context: HandedOff) => McpServer;

interface Offered<R extends Registration> {
  readonly registration: R;
  readonly definition: ToolDefinition;
  readonly plainLanguage: RegisteredPlainLanguage;
}

interface Tool extends CalledTool {
  readonly name: string;
  readonly definition: ToolDefinition;
}

function serverWithTools(serving: ToolServing, instructions: string, call: OrgCall, tools: readonly Tool[]): McpServer {
  const server = new McpServer(
    { ...serving.serverInfo },
    { capabilities: { tools: { listChanged: false } }, instructions },
  );
  for (const tool of tools) {
    server.registerTool(tool.name, tool.definition, callbackFor(serving, call, tool));
  }
  return server;
}

function plainLanguageOf({ name, plainLanguage }: Registration): RegisteredPlainLanguage {
  if (plainLanguage === undefined) {
    throw new Error(`The operation ${name} has no plain language for the results of its MCP tool`);
  }
  return plainLanguage;
}

function offered<R extends Registration>(
  registrations: readonly R[],
  definitionOf: (registration: R) => ToolDefinition,
): readonly Offered<R>[] {
  return registrations.map((registration) => ({
    registration,
    definition: definitionOf(registration),
    plainLanguage: plainLanguageOf(registration),
  }));
}

function namesOf(offers: readonly Offered<Registration>[]): readonly string[] {
  return offers.map(({ registration }) => registration.name);
}

function toolsOf<R extends Registration>(
  offers: readonly Offered<R>[],
  dispatchOf: (registration: R) => Dispatch,
): readonly Tool[] {
  return offers.map(({ registration, definition, plainLanguage }) => ({
    name: registration.name,
    definition,
    kind: registration.kind,
    plainLanguage,
    dispatch: dispatchOf(registration),
  }));
}

function orgDispatchOf(
  dispatcher: Dispatcher,
  { caller, org }: OrgCall,
): (registration: Registration<'org'>) => Dispatch {
  return (registration) => (input) => dispatcher.dispatchToOrg(registration, { caller, org, input, encoding: 'json' });
}

function brainDispatchOf(
  dispatcher: Dispatcher,
  { caller, org, brain }: BrainCall,
): (registration: Registration<'brain'>) => Dispatch {
  return (registration) => (input) =>
    dispatcher.dispatchToBrain(registration, { caller, org, brain, input, encoding: 'json' });
}

function brainArgumentDispatchOf(
  dispatcher: Dispatcher,
  { caller, org }: OrgCall,
): (registration: Registration<'brain'>) => Dispatch {
  return (registration) => (input) => {
    const argument = brainArgumentOf(input);
    return Result.isFailure(argument)
      ? Effect.succeed(argument.failure)
      : dispatcher.dispatchToBrain(registration, { caller, org, ...argument.success, encoding: 'json' });
  };
}

export function orgServerFactory(serving: ToolServing): McpServerFactory {
  const orgOffers = offered(serving.catalog.operationsIn('org'), toolDefinitionOf);
  const instructions = instructionsFor(
    'org',
    { orgTools: namesOf(orgOffers), brainTools: [] },
    serving.definitionTypes,
  );
  return (context) => {
    const call = orgCallOf(context);
    const tools = toolsOf(orgOffers, orgDispatchOf(serving.dispatcher, call));
    return serverWithTools(serving, instructions, call, tools);
  };
}

export function brainServerFactory(serving: ToolServing): McpServerFactory {
  const brainOffers = offered(serving.catalog.operationsIn('brain'), toolDefinitionOf);
  const instructions = instructionsFor(
    'brain',
    { orgTools: [], brainTools: namesOf(brainOffers) },
    serving.definitionTypes,
  );
  return (context) => {
    const call = brainCallOf(context);
    const tools = toolsOf(brainOffers, brainDispatchOf(serving.dispatcher, call));
    return serverWithTools(serving, instructions, call, tools);
  };
}

export function catalogServerFactory(serving: ToolServing): McpServerFactory {
  const orgOffers = offered(serving.catalog.operationsIn('org'), toolDefinitionOf);
  const brainOffers = offered(serving.catalog.operationsIn('brain'), toolDefinitionTakingBrainOf);
  const instructions = instructionsFor(
    'own org',
    { orgTools: namesOf(orgOffers), brainTools: namesOf(brainOffers) },
    serving.definitionTypes,
  );
  return (context) => {
    const call = orgCallOf(context);
    const tools = [
      ...toolsOf(orgOffers, orgDispatchOf(serving.dispatcher, call)),
      ...toolsOf(brainOffers, brainArgumentDispatchOf(serving.dispatcher, call)),
    ];
    return serverWithTools(serving, instructions, call, tools);
  };
}
