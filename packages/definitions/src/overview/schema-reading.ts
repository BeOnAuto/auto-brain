import type { Schema } from 'effect';

export type JsonSchema = Schema.JsonObject;

export interface SchemaReading {
  readonly root: JsonSchema;
  readonly depth: number;
  readonly expanded: boolean;
}

type Entry = readonly [string, Schema.Json];

export const mostSchemaDepth = 8;

const anything: JsonSchema = {};

export function isJsonSchema(value: Schema.Json | undefined): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isJsonList(value: Schema.Json | undefined): value is Schema.JsonArray {
  return Array.isArray(value);
}

function schemaOf(value: Schema.Json | undefined): JsonSchema {
  return isJsonSchema(value) ? value : anything;
}

export function textOf(schema: JsonSchema, keyword: string): string | undefined {
  const value = schema[keyword];
  return typeof value === 'string' ? value : undefined;
}

export function numberOf(schema: JsonSchema, keyword: string): number | undefined {
  const value = schema[keyword];
  return typeof value === 'number' ? value : undefined;
}

export function listOf(schema: JsonSchema, keyword: string): Schema.JsonArray {
  const value = schema[keyword];
  return isJsonList(value) ? value : [];
}

function unescapedSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function pointedSchema(root: JsonSchema, reference: string): JsonSchema {
  if (!reference.startsWith('#')) {
    return anything;
  }
  let schema: Schema.Json | undefined = root;
  for (const segment of reference.slice(1).split('/').slice(1)) {
    schema = isJsonSchema(schema) ? schema[unescapedSegment(segment)] : undefined;
  }
  return schemaOf(schema);
}

export function deeper(reading: SchemaReading, expanded = reading.expanded): SchemaReading {
  return { ...reading, depth: reading.depth + 1, expanded };
}

interface ReadSchema {
  readonly schema: JsonSchema;
  readonly reading: SchemaReading;
}

export function resolvedSchema(schema: JsonSchema, reading: SchemaReading): ReadSchema {
  const reference = textOf(schema, '$ref');
  if (reference === undefined || reading.depth > mostSchemaDepth) {
    return { schema, reading };
  }
  const own = Object.entries(schema).filter((entry: Entry) => entry[0] !== '$ref');
  const referenced = resolvedSchema(pointedSchema(reading.root, reference), deeper(reading));
  return { schema: Object.fromEntries([...Object.entries(referenced.schema), ...own]), reading: referenced.reading };
}

export function typesOf(schema: JsonSchema): readonly string[] {
  const type = schema['type'];
  if (typeof type === 'string') {
    return [type];
  }
  return isJsonList(type) ? type.filter((each) => typeof each === 'string') : [];
}

export function propertiesOf(schema: JsonSchema): readonly (readonly [string, JsonSchema])[] {
  const properties = schema['properties'];
  return isJsonSchema(properties)
    ? Object.entries(properties).map(([name, value]: Entry) => [name, schemaOf(value)] as const)
    : [];
}

export function requiredOf(schema: JsonSchema): ReadonlySet<string> {
  return new Set(listOf(schema, 'required').filter((name) => typeof name === 'string'));
}
