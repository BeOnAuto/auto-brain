import { InvalidInput } from '@beonauto/operations';
import { Effect, Result, type Schema } from 'effect';

import { checkedAnswer } from './answer-check.ts';

export function answerFor(answer: Schema.Json, schema: Schema.JsonObject): Effect.Effect<Schema.Json, InvalidInput> {
  return Result.match(checkedAnswer(answer, schema), {
    onSuccess: Effect.succeed,
    onFailure: (issues) =>
      Effect.fail(
        new InvalidInput({
          detail: 'The answer does not match the answer schema of the request',
          issues: issues.map(({ pointer, detail }) => ({ pointer: `/answer${pointer}`, detail })),
        }),
      ),
  });
}
