import { Buffer } from 'node:buffer';

import { wordedIssuesOf } from '@on.auto/definitions';
import { compileJsonSchema, type CompiledSchema } from '@on.auto/json-schema';
import { asSentence, type Issue } from '@on.auto/operations';
import { Result, type Schema } from 'effect';

import { interactionBounds } from '../run/run-bounds.ts';

const unreadableSchema = 'The answer schema of the request cannot be read';

function answerSchemaOf(schema: Schema.JsonObject): Result.Result<CompiledSchema, readonly Issue[]> {
  return compileJsonSchema(schema, { what: 'answer', nesting: interactionBounds.answerDepth });
}

export function matchedAnswer(
  answer: Schema.Json,
  schema: Schema.JsonObject,
): Result.Result<Schema.Json, readonly Issue[]> {
  const compiled = answerSchemaOf(schema);
  return Result.isFailure(compiled)
    ? Result.fail([{ pointer: '', detail: unreadableSchema }])
    : compiled.success.validate(answer);
}

function refusalOf(detail: string): readonly Issue[] {
  return [{ pointer: '', detail: asSentence(detail) }];
}

function issuesOfAnswer(answer: Schema.Json, schema: Schema.JsonObject): readonly Issue[] {
  const bytes = Buffer.byteLength(JSON.stringify(answer), 'utf8');
  if (bytes > interactionBounds.answerBytes) {
    return refusalOf(
      `The answer takes ${bytes} bytes as JSON, more than the ${interactionBounds.answerBytes} an answer may`,
    );
  }
  const compiled = answerSchemaOf(schema);
  return Result.isFailure(compiled) ? refusalOf(unreadableSchema) : wordedIssuesOf(compiled.success, answer);
}

export function answerIssuesOf(answer: Schema.Json, schema: Schema.JsonObject): readonly Issue[] {
  return issuesOfAnswer(answer, schema).map(({ pointer, detail }) => ({ pointer: `/answer${pointer}`, detail }));
}
