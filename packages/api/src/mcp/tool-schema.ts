import type { JsonSchemaDocument } from '@beonauto/operations';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';

export type JsonSchema = Record<string, unknown>;

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const definitionReference = /^#\/\$defs\/(.+)$/u;

function withoutReference(schema: Readonly<Record<string, unknown>>): JsonSchema {
  return Object.fromEntries(
    Object.entries(schema).filter(([keyword]: readonly [string, unknown]) => keyword !== '$ref'),
  );
}

export function inlinedRootOf({ schema, definitions }: JsonSchemaDocument): JsonSchema {
  const reference = schema['$ref'];
  const name = typeof reference === 'string' ? definitionReference.exec(reference)?.[1] : undefined;
  const definition = name === undefined ? undefined : definitions[name];
  return definition === undefined ? { ...schema } : { ...definition, ...withoutReference(schema) };
}

export function selfContainedSchemaOf(document: JsonSchemaDocument): JsonSchema {
  const root = { $schema: dialect, ...inlinedRootOf(document) };
  return Object.keys(document.definitions).length === 0 ? root : { ...root, $defs: { ...document.definitions } };
}

export function advertisedSchema(jsonSchema: Readonly<JsonSchema>): StandardSchemaWithJSON {
  return {
    '~standard': {
      version: 1,
      vendor: 'auto-brain',
      validate: (value) => ({ value }),
      jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
    },
  };
}

export function advertisedSchemaOf(document: JsonSchemaDocument): StandardSchemaWithJSON {
  return advertisedSchema(selfContainedSchemaOf(document));
}
