import type { Registration } from '@beonauto/operations';
import type { StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';

import { advertisedSchemaOf } from './tool-schema.ts';

export interface ToolDefinition {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: StandardSchemaWithJSON;
  readonly outputSchema: StandardSchemaWithJSON;
  readonly annotations: ToolAnnotations;
}

function annotationsOf({ kind, route }: Registration): ToolAnnotations {
  return {
    readOnlyHint: kind === 'query',
    destructiveHint: false,
    idempotentHint: route.method === 'GET' || route.method === 'PUT',
    openWorldHint: false,
  };
}

export function toolDefinitionOf(registration: Registration): ToolDefinition {
  return {
    title: registration.title,
    description: registration.description,
    inputSchema: advertisedSchemaOf(registration.input),
    outputSchema: advertisedSchemaOf(registration.output),
    annotations: annotationsOf(registration),
  };
}
