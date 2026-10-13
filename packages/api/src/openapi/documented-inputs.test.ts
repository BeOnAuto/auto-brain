import { makeCatalog, type RouteRegistration } from '@on.auto/operations';
import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { guideShelfOf } from '../guides/guide-shelf.ts';
import { blobOperations } from '../testing/blob-operations.ts';
import { testDefinitionTypes, testGuides, testRecipes } from '../testing/guides.ts';
import { listNotesOfTheOrg, notebookOperations } from '../testing/notebook.ts';
import { operationsIn, type DocumentedOperation } from '../testing/openapi-document.ts';
import { testServerInfo } from '../testing/operation-server.ts';
import { openApiDocumentOf } from './openapi-document.ts';

const catalog = makeCatalog([...notebookOperations, listNotesOfTheOrg, ...blobOperations]);

const documented = operationsIn(
  openApiDocumentOf(catalog, testServerInfo, guideShelfOf(testGuides, testRecipes, testDefinitionTypes)),
);

const FieldsSchema = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

const ParameterSchema = Schema.Struct({
  name: Schema.String,
  in: Schema.String,
  required: Schema.Boolean,
  schema: Schema.Unknown,
});

const BodySchema = Schema.Struct({
  content: Schema.Record(Schema.String, Schema.Struct({ schema: Schema.optionalKey(FieldsSchema) })),
});

interface Fields {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
}

function fieldsGivenBesidesThePath({ input, pathParameters }: RouteRegistration): Fields {
  const { properties = {}, required = [] } = Schema.decodeUnknownSync(FieldsSchema)(input.schema);
  return {
    properties: Object.fromEntries(
      Object.entries(properties).filter(([name]: readonly [string, unknown]) => !pathParameters.includes(name)),
    ),
    required: required.filter((name) => !pathParameters.includes(name)),
  };
}

function queriedFieldsOf({ operation }: DocumentedOperation): Fields {
  const parameters = operation.parameters
    .filter((parameter) => parameter['in'] === 'query')
    .map((parameter) => Schema.decodeUnknownSync(ParameterSchema)(parameter));
  return {
    properties: Object.fromEntries(parameters.map(({ name, schema }) => [name, schema])),
    required: parameters.filter(({ required }) => required).map(({ name }) => name),
  };
}

function bodyFieldsOf({ operation }: DocumentedOperation): Fields {
  const { content } = Schema.decodeUnknownSync(BodySchema)(operation.requestBody ?? { content: {} });
  const { properties = {}, required = [] } = content['application/json']?.schema ?? {};
  return { properties, required };
}

function documentedFieldsOf(described: DocumentedOperation): Fields {
  return described.method === 'get' ? queriedFieldsOf(described) : bodyFieldsOf(described);
}

function documentedOf({ scope, name }: RouteRegistration): readonly DocumentedOperation[] {
  const id = scope === 'org' && name === 'list_notes' ? 'list_notes_in_org' : name;
  return documented.filter(({ operation }) => operation.operationId === id);
}

describe('the input an operation documents', () => {
  it.each(catalog.operations)(
    "is, for $name, its registration's input without the fields of its path, in its query or its body",
    (registration) => {
      expect(documentedOf(registration).map((described) => documentedFieldsOf(described))).toEqual([
        fieldsGivenBesidesThePath(registration),
      ]);
    },
  );
});
