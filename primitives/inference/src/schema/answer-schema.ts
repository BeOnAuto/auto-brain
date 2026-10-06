import {
  compileJsonSchema,
  jsonSchemaLimits,
  type CompiledSchema,
  type SchemaIssue as Issue,
} from '@beonauto/specs/document';
import { Result } from 'effect';

import { portabilityOf, type PortabilityIssue } from './schema-portability.ts';

export const schemaLimits = {
  ...jsonSchemaLimits,
  answerNesting: 128,
} as const;

export type AnswerSchema = CompiledSchema;

export interface SchemaReport {
  readonly unsupported: readonly Issue[];
  readonly not_portable: readonly PortabilityIssue[];
  readonly unchecked: readonly Issue[];
}

export function compileAnswerSchema(document: unknown): Result.Result<AnswerSchema, readonly Issue[]> {
  return compileJsonSchema(document, { what: 'answer', nesting: schemaLimits.answerNesting });
}

export function checkAnswerSchema(document: unknown): SchemaReport {
  const compiled = compileAnswerSchema(document);
  if (Result.isFailure(compiled)) {
    return { unsupported: compiled.failure, not_portable: [], unchecked: [] };
  }
  return { unsupported: [], ...portabilityOf(compiled.success.document) };
}
