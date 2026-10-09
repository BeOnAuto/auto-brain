import { Buffer } from 'node:buffer';

import { compileJsonSchema } from '@beonauto/definitions/document';
import type { Issue } from '@beonauto/operations';
import { Result, type Schema } from 'effect';

import { interactionBounds } from '../run/run-bounds.ts';

export function checkedAnswer(
  answer: Schema.Json,
  schema: Schema.JsonObject,
): Result.Result<Schema.Json, readonly Issue[]> {
  const bytes = Buffer.byteLength(JSON.stringify(answer), 'utf8');
  if (bytes > interactionBounds.answerBytes) {
    return Result.fail([
      {
        pointer: '',
        detail: `The answer takes ${bytes} bytes as JSON, more than the ${interactionBounds.answerBytes} an answer may`,
      },
    ]);
  }
  const compiled = compileJsonSchema(schema, { what: 'answer', nesting: interactionBounds.answerDepth });
  return Result.isFailure(compiled)
    ? Result.fail([{ pointer: '', detail: 'The answer schema of the request cannot be read' }])
    : compiled.success.validate(answer);
}
