import type { Registration } from '@beonauto/operations';
import type { StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';

import {
  mostArgumentDescriptionCharacters,
  mostDescriptionCharacters,
  requireSentencesWithin,
  requireTextWithin,
} from '../bounds/served-bounds.ts';
import { argumentDescriptionsIn } from './argument-descriptions.ts';
import { withBrainArgument } from './brain-argument.ts';
import { advertisedSchema, selfContainedSchemaOf, type JsonSchema } from './tool-schema.ts';

export interface ToolDefinition {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: StandardSchemaWithJSON;
  readonly annotations: ToolAnnotations;
}

function annotationsOf({
  kind,
  reachesOutside,
  mayChangeOutside,
  irreversible,
  repeatable,
}: Registration): ToolAnnotations {
  return {
    readOnlyHint: kind === 'query',
    destructiveHint: irreversible || mayChangeOutside,
    idempotentHint: kind === 'query' || repeatable,
    openWorldHint: reachesOutside,
  };
}

function requireArgumentsWithinBounds(name: string, schema: Readonly<JsonSchema>): void {
  for (const { where, description } of argumentDescriptionsIn(schema)) {
    requireTextWithin(`The description of ${where} of ${name}`, description, mostArgumentDescriptionCharacters);
  }
}

function requireDescriptionWithinBounds({ name, description }: Registration): void {
  requireTextWithin(`The description of ${name}`, description, mostDescriptionCharacters);
  requireSentencesWithin(`The description of ${name}`, description);
}

function definitionWith(registration: Registration, inputSchema: Readonly<JsonSchema>): ToolDefinition {
  requireDescriptionWithinBounds(registration);
  requireArgumentsWithinBounds(registration.name, inputSchema);
  return {
    title: registration.title,
    description: registration.description,
    inputSchema: advertisedSchema(inputSchema),
    annotations: annotationsOf(registration),
  };
}

export function toolDefinitionOf(registration: Registration): ToolDefinition {
  return definitionWith(registration, selfContainedSchemaOf(registration.input));
}

export function toolDefinitionTakingBrainOf(registration: Registration<'brain'>): ToolDefinition {
  return definitionWith(registration, withBrainArgument(selfContainedSchemaOf(registration.input)));
}
