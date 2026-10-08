import {
  type CallerIdentity,
  type RegisteredPlainLanguage,
  type Registration,
  type Dispatcher,
} from '@beonauto/operations';
import type { McpServer } from '@modelcontextprotocol/server';
import { Effect, Result } from 'effect';

import { brainCallOf, orgCallOf, type BrainCall, type HandedOff, type OrgCall } from '../hand-off/caller-hand-off.ts';
import type { ReportThrown } from '../problem/error-boundary.ts';
import { brainArgumentOf, withoutBrain } from '../tools/brain-argument.ts';
import { callbackFor, type Arguments, type CalledTool, type Dispatch } from '../tools/tool-callback.ts';
import { toolDefinitionOf, toolDefinitionTakingBrainOf, type ToolDefinition } from '../tools/tool-definition.ts';
import type { ServedTools } from './instructions.ts';
import { connectionOf, serverOf, type Connection, type McpServing } from './mcp-connection.ts';

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

function permittedTo<R extends Registration>(
  { permissions }: CallerIdentity,
  offers: readonly Offered<R>[],
): readonly Offered<R>[] {
  return offers.filter(({ registration }) =>
    registration.permissions.some((permission) => permissions.includes(permission)),
  );
}

function namesOf(offers: readonly Offered<Registration>[]): readonly string[] {
  return offers.map(({ registration }) => registration.name);
}

function servedTools(
  orgOffers: readonly Offered<Registration>[],
  brainOffers: readonly Offered<Registration>[],
): ServedTools {
  return { orgTools: namesOf(orgOffers), brainTools: namesOf(brainOffers) };
}

function asGiven(input: Arguments): Arguments {
  return input;
}

function toolsOf<R extends Registration>(
  offers: readonly Offered<R>[],
  dispatchOf: (registration: R) => Dispatch,
  operationInputOf: (input: Arguments) => Arguments = asGiven,
): readonly Tool[] {
  return offers.map(({ registration, definition, plainLanguage }) => ({
    name: registration.name,
    definition,
    kind: registration.kind,
    plainLanguage,
    dispatch: dispatchOf(registration),
    operationInputOf,
  }));
}

interface ConnectedCall {
  readonly connection: Connection;
  readonly serving: ToolServing;
  readonly call: OrgCall;
}

function serverWithTools(
  { connection, serving, call }: ConnectedCall,
  served: ServedTools,
  tools: readonly Tool[],
): McpServer {
  return serverOf(connection, served, (server) => {
    for (const tool of tools) {
      server.registerTool(tool.name, tool.definition, callbackFor(serving, call, tool));
    }
  });
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
  const connection = connectionOf('org', serving, servedTools(orgOffers, []));
  return (context) => {
    const call = orgCallOf(context);
    const listed = permittedTo(call.caller, orgOffers);
    const tools = toolsOf(listed, orgDispatchOf(serving.dispatcher, call));
    return serverWithTools({ connection, serving, call }, servedTools(listed, []), tools);
  };
}

export function brainServerFactory(serving: ToolServing): McpServerFactory {
  const brainOffers = offered(serving.catalog.operationsIn('brain'), toolDefinitionOf);
  const connection = connectionOf('brain', serving, servedTools([], brainOffers));
  return (context) => {
    const call = brainCallOf(context);
    const listed = permittedTo(call.caller, brainOffers);
    const tools = toolsOf(listed, brainDispatchOf(serving.dispatcher, call));
    return serverWithTools({ connection, serving, call }, servedTools([], listed), tools);
  };
}

export function catalogServerFactory(serving: ToolServing): McpServerFactory {
  const orgOffers = offered(serving.catalog.operationsIn('org'), toolDefinitionOf);
  const brainOffers = offered(serving.catalog.operationsIn('brain'), toolDefinitionTakingBrainOf);
  const connection = connectionOf('own org', serving, servedTools(orgOffers, brainOffers));
  return (context) => {
    const call = orgCallOf(context);
    const listedInOrg = permittedTo(call.caller, orgOffers);
    const listedInBrain = permittedTo(call.caller, brainOffers);
    const tools = [
      ...toolsOf(listedInOrg, orgDispatchOf(serving.dispatcher, call)),
      ...toolsOf(listedInBrain, brainArgumentDispatchOf(serving.dispatcher, call), withoutBrain),
    ];
    return serverWithTools({ connection, serving, call }, servedTools(listedInOrg, listedInBrain), tools);
  };
}
