import type { Registration } from '@beonauto/operations';
import type { StandardSchemaWithJSON, ToolAnnotations } from '@modelcontextprotocol/server';
import { Schema } from 'effect';

import {
  mostArgumentDescriptionCharacters,
  mostDescriptionCharacters,
  requireTextWithin,
} from '../bounds/served-bounds.ts';
import { withBrainArgument } from './brain-argument.ts';
import { advertisedSchema, objectMembersOf, selfContainedSchemaOf, type JsonSchema } from './tool-schema.ts';

export interface ToolDefinition {
  readonly title: string;
  readonly description: string;
  readonly inputSchema: StandardSchemaWithJSON;
  readonly outputSchema: StandardSchemaWithJSON;
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

const ArgumentsSchema = Schema.Struct({
  properties: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Struct({ description: Schema.optionalKey(Schema.String) })),
  ),
});

const argumentsOf = Schema.decodeUnknownSync(ArgumentsSchema);

function requireArgumentsWithinBounds(name: string, schema: Readonly<JsonSchema>): void {
  for (const member of objectMembersOf(schema)) {
    const { properties = {} } = argumentsOf(member);
    for (const [argument, { description = '' }] of Object.entries(properties)) {
      requireTextWithin(`The description of ${argument} of ${name}`, description, mostArgumentDescriptionCharacters);
    }
  }
}

function definitionWith(registration: Registration, inputSchema: Readonly<JsonSchema>): ToolDefinition {
  requireTextWithin(`The description of ${registration.name}`, registration.description, mostDescriptionCharacters);
  requireArgumentsWithinBounds(registration.name, inputSchema);
  return {
    title: registration.title,
    description: registration.description,
    inputSchema: advertisedSchema(inputSchema),
    outputSchema: advertisedSchema(selfContainedSchemaOf(registration.output)),
    annotations: annotationsOf(registration),
  };
}

export function toolDefinitionOf(registration: Registration): ToolDefinition {
  return definitionWith(registration, selfContainedSchemaOf(registration.input));
}

export function toolDefinitionTakingBrainOf(registration: Registration<'brain'>): ToolDefinition {
  return definitionWith(registration, withBrainArgument(selfContainedSchemaOf(registration.input)));
}
