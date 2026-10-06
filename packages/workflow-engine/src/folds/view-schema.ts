import {
  JsonPointer,
  JsonSchema,
  Result,
  Schema,
  SchemaIssue,
  SchemaRepresentation,
  type StandardSchema,
} from 'effect';

import type { Json, JsonObject } from '../dsl/json.ts';

export type ViewCheck = (view: Json) => string | undefined;

type IssueSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

const draft07 = 'http://json-schema.org/draft-07/schema';

const strictly = { onExcessProperty: 'error', errors: 'all' } as const;

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

function isDraft07(document: JsonObject): boolean {
  const declared = document['$schema'];
  const draft = typeof declared === 'string' && declared.replace(/#$/u, '') === draft07;
  return draft || (document['definitions'] !== undefined && document['$defs'] === undefined);
}

function isPropertyKey(segment: IssueSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function placeOf(path: readonly IssueSegment[]): string {
  const keys = path.filter((segment) => isPropertyKey(segment));
  return keys.length === 0 ? 'the view' : keys.map((key) => `/${JsonPointer.escapeToken(String(key))}`).join('');
}

export function viewCheckOf(document: JsonObject): ViewCheck {
  const imported = isDraft07(document)
    ? JsonSchema.fromSchemaDraft07(document)
    : JsonSchema.fromSchemaDraft2020_12(document);
  const representation = SchemaRepresentation.fromJsonSchemaDocument(imported);
  const decode = Schema.decodeUnknownResult(Schema.make<Schema.Codec<unknown>>(representation.ast), strictly);
  return (view) => {
    const decoded = decode(view);
    return Result.isSuccess(decoded)
      ? undefined
      : formatIssues(decoded.failure.issue)
          .issues.map(({ message, path = [] }) => `${placeOf(path)}: ${message}`)
          .join('; ');
  };
}
