import type { Catalog, Dispatcher } from '@beonauto/operations';
import { McpServer } from '@modelcontextprotocol/server';

import {
  mostInstructionCharacters,
  mostToolsOnAConnection,
  requireTextWithin,
  requireWithin,
} from '../bounds/served-bounds.ts';
import { serveGuides, type GuideRegistry } from '../guides/guide-serving.ts';
import { guideShelfOf, type Guide, type GuideShelf, type Recipe } from '../guides/guide-shelf.ts';
import { guideToolName } from '../guides/guide-tool.ts';
import type { RunCall } from '../operations/operation-routes.ts';
import { instructionsFor, type DefinitionType, type McpEndpoint, type ServedTools } from './instructions.ts';

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
  readonly guides: readonly Guide[];
  readonly recipes: readonly Recipe[];
}

export interface Connection {
  readonly endpoint: McpEndpoint;
  readonly serving: McpServing;
  readonly shelf: GuideShelf;
}

const noChangesAnnounced = { listChanged: false };

function instructionsOf({ endpoint, serving, shelf }: Connection, served: ServedTools): string {
  return instructionsFor(endpoint, served, serving.definitionTypes, shelf.recipes);
}

export function connectionOf(endpoint: McpEndpoint, serving: McpServing, everyTool: ServedTools): Connection {
  const connection = {
    endpoint,
    serving,
    shelf: guideShelfOf(serving.guides, serving.recipes, serving.definitionTypes),
  };
  const toolCount = [...everyTool.orgTools, ...everyTool.brainTools, guideToolName].length;
  requireWithin(`The ${endpoint} endpoint`, toolCount, mostToolsOnAConnection, 'tools');
  requireTextWithin(
    `The instructions of the ${endpoint} endpoint`,
    instructionsOf(connection, everyTool),
    mostInstructionCharacters,
  );
  return connection;
}

export function serverOf(
  connection: Connection,
  served: ServedTools,
  registerTools: (server: GuideRegistry) => void,
): McpServer {
  const server = new McpServer(
    { ...connection.serving.serverInfo },
    {
      capabilities: { tools: noChangesAnnounced, resources: noChangesAnnounced, prompts: noChangesAnnounced },
      instructions: instructionsOf(connection, served),
    },
  );
  registerTools(server);
  serveGuides(server, connection.shelf);
  return server;
}
