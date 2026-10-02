import { JsonSchema, Result, Schema, SchemaIssue, SchemaRepresentation, type StandardSchema } from 'effect';

import {
  boundedIssues,
  hiddenIssues,
  mostIssues,
  nestedDeeperThan,
  pointerOf,
  utf8Bytes,
  type SchemaIssue as Issue,
} from './json-bounds.ts';
import { referenceLoopIssues } from './reference-loops.ts';
import { portabilityOf, type PortabilityIssue } from './schema-portability.ts';
import { shapeIssues } from './schema-shape.ts';

export const schemaLimits = {
  bytes: 65_536,
  nesting: 64,
  answerNesting: 128,
  issues: mostIssues,
} as const;

export interface AnswerSchema {
  readonly document: Schema.JsonObject;
  readonly validate: (answer: unknown) => Result.Result<Schema.Json, readonly Issue[]>;
}

export interface SchemaReport {
  readonly unsupported: readonly Issue[];
  readonly not_portable: readonly PortabilityIssue[];
  readonly unchecked: readonly Issue[];
}

type Decoder = (input: unknown) => Result.Result<unknown, Schema.SchemaError>;

type IssueSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

const isJsonObject = Schema.is(Schema.JsonObject);

const isJson = Schema.is(Schema.Json);

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

const strictly = { onExcessProperty: 'error', errors: 'all' } as const;

const draft07 = 'http://json-schema.org/draft-07/schema';

const issueBounds = {
  keyOf: ({ pointer, detail }: Issue) => `${pointer}\u0000${detail}`,
  hidden: (count: number): Issue => ({ pointer: '', detail: hiddenIssues(count) }),
};

function rootIssue(detail: string): readonly Issue[] {
  return [{ pointer: '', detail }];
}

function boundedDocument(document: unknown): Result.Result<Schema.JsonObject, readonly Issue[]> {
  if (nestedDeeperThan(document, schemaLimits.nesting)) {
    return Result.fail(rootIssue(`A schema may nest at most ${schemaLimits.nesting} levels of objects and lists`));
  }
  if (!isJsonObject(document)) {
    return Result.fail(rootIssue('A schema is a JSON object'));
  }
  return utf8Bytes(JSON.stringify(document)) > schemaLimits.bytes
    ? Result.fail(rootIssue(`A schema may take at most ${schemaLimits.bytes} bytes as JSON`))
    : Result.succeed(document);
}

function wellFormedDocument(document: Schema.JsonObject): Result.Result<Schema.JsonObject, readonly Issue[]> {
  const issues = [...shapeIssues(document), ...referenceLoopIssues(document)];
  return issues.length > 0 ? Result.fail(boundedIssues(issues, issueBounds)) : Result.succeed(document);
}

function isDraft07(document: Schema.JsonObject): boolean {
  const declared = document['$schema'];
  const draft = typeof declared === 'string' && declared.replace(/#$/u, '') === draft07;
  return draft || (document['definitions'] !== undefined && document['$defs'] === undefined);
}

function importedDocument(document: Schema.JsonObject): JsonSchema.Document<'draft-2020-12'> {
  return isDraft07(document) ? JsonSchema.fromSchemaDraft07(document) : JsonSchema.fromSchemaDraft2020_12(document);
}

function importFailure(error: unknown): string {
  return String(error)
    .replace(/^Error: /u, '')
    .replace(/\n.*$/su, '');
}

function decoderOf(document: Schema.JsonObject): Result.Result<Decoder, readonly Issue[]> {
  try {
    const imported = SchemaRepresentation.fromJsonSchemaDocument(importedDocument(document));
    return Result.succeed(Schema.decodeUnknownResult(Schema.make<Schema.Codec<unknown>>(imported.ast), strictly));
  } catch (error) {
    return Result.fail(rootIssue(importFailure(error)));
  }
}

function isPropertyKey(segment: IssueSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function answerIssues(issues: readonly StandardSchema.StandardSchemaV1.Issue[]): readonly Issue[] {
  const found = issues.map(({ message, path = [] }) => ({
    pointer: pointerOf(path.filter((segment) => isPropertyKey(segment))),
    detail: message,
  }));
  return boundedIssues(found, issueBounds);
}

function validatorOf(decode: Decoder): AnswerSchema['validate'] {
  return (answer) => {
    if (nestedDeeperThan(answer, schemaLimits.answerNesting)) {
      return Result.fail(rootIssue(`The answer nests more than ${schemaLimits.answerNesting} levels`));
    }
    if (!isJson(answer)) {
      return Result.fail(rootIssue('The answer is not JSON'));
    }
    const decoded = decode(answer);
    return Result.isSuccess(decoded)
      ? Result.succeed(answer)
      : Result.fail(answerIssues(formatIssues(decoded.failure.issue).issues));
  };
}

export function compileAnswerSchema(document: unknown): Result.Result<AnswerSchema, readonly Issue[]> {
  return boundedDocument(document).pipe(
    Result.flatMap(wellFormedDocument),
    Result.flatMap((usable) =>
      Result.map(decoderOf(usable), (decode) => ({ document: usable, validate: validatorOf(decode) })),
    ),
  );
}

export function checkAnswerSchema(document: unknown): SchemaReport {
  const compiled = compileAnswerSchema(document);
  if (Result.isFailure(compiled)) {
    return { unsupported: compiled.failure, not_portable: [], unchecked: [] };
  }
  return { unsupported: [], ...portabilityOf(compiled.success.document) };
}
