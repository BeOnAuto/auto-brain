import type { Schema } from 'effect';

import { pointerOf, type SchemaIssue } from './json-bounds.ts';
import { schemaNodes, type Path, type SchemaNode } from './schema-nodes.ts';
import { isKnownKeyword } from './schema-shape.ts';

export interface PortabilityIssue extends SchemaIssue {
  readonly providers: readonly string[];
}

export interface Portability {
  readonly not_portable: readonly PortabilityIssue[];
  readonly unchecked: readonly SchemaIssue[];
}

const anthropicModels = ['anthropic', 'bedrock', 'bedrock-anthropic', 'vertex-anthropic'];
const strictOpenAi = ['openai', 'azure'];
const objectAtRoot = [...anthropicModels, ...strictOpenAi];

const boundKeywords = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
];

const anthropicFormats: ReadonlySet<Schema.Json> = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

function portabilityIssue(path: Path, detail: string, providers: readonly string[]): readonly PortabilityIssue[] {
  return [{ pointer: pointerOf(path), detail, providers }];
}

function describesObject(schema: Schema.JsonObject): boolean {
  const type = schema['type'];
  const types: readonly Schema.Json[] = Array.isArray(type) ? type : [type ?? null];
  return types.includes('object') || schema['properties'] !== undefined;
}

function rootIssues(root: Schema.JsonObject): readonly PortabilityIssue[] {
  return root['type'] === 'object'
    ? []
    : portabilityIssue(['type'], 'The root of the schema should be "type": "object"', objectAtRoot);
}

function closedObjectIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  if (!describesObject(schema) || schema['additionalProperties'] === false) {
    return [];
  }
  return portabilityIssue(
    path,
    'An object should set "additionalProperties": false; strict structured outputs reject open objects',
    strictOpenAi,
  );
}

function requiredKeyIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  const properties = schema['properties'];
  const required = schema['required'];
  const names = properties !== null && typeof properties === 'object' ? Object.keys(properties) : [];
  const requiredNames: readonly Schema.Json[] = Array.isArray(required) ? required : [];
  const optional = names.filter((name) => !requiredNames.includes(name));
  return optional.length === 0
    ? []
    : portabilityIssue(
        [...path, 'required'],
        `Every property should be required (make an optional one nullable instead): ${optional.join(', ')}`,
        strictOpenAi,
      );
}

function boundIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  return boundKeywords
    .filter((keyword) => schema[keyword] !== undefined)
    .flatMap((keyword) =>
      portabilityIssue(
        [...path, keyword],
        `${keyword} is not enforced while Anthropic models write the answer; an answer outside it fails as output_invalid`,
        anthropicModels,
      ),
    );
}

function oneOfIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  return schema['oneOf'] === undefined
    ? []
    : portabilityIssue(
        [...path, 'oneOf'],
        'oneOf is sent to Anthropic models as anyOf; an answer matching more than one branch fails as output_invalid',
        anthropicModels,
      );
}

function formatIssues({ schema, path }: SchemaNode): readonly PortabilityIssue[] {
  const format = schema['format'];
  return format === undefined || anthropicFormats.has(format)
    ? []
    : portabilityIssue([...path, 'format'], 'Anthropic models do not accept this format', anthropicModels);
}

function uncheckedIssues({ schema, path }: SchemaNode): readonly SchemaIssue[] {
  const unknown = Object.keys(schema)
    .filter((keyword) => !isKnownKeyword(keyword))
    .map((keyword) => ({
      pointer: pointerOf([...path, keyword]),
      detail: `${keyword} is not a keyword this package checks; it is sent to the provider as written`,
    }));
  const format =
    schema['format'] === undefined
      ? []
      : [{ pointer: pointerOf([...path, 'format']), detail: 'format is sent to the provider but not checked here' }];
  return [...unknown, ...format];
}

const nodeRules = [closedObjectIssues, requiredKeyIssues, boundIssues, oneOfIssues, formatIssues];

export function portabilityOf(root: Schema.JsonObject): Portability {
  const nodes = schemaNodes(root);
  return {
    not_portable: [...rootIssues(root), ...nodes.flatMap((node) => nodeRules.flatMap((rule) => rule(node)))],
    unchecked: nodes.flatMap((node) => uncheckedIssues(node)),
  };
}
