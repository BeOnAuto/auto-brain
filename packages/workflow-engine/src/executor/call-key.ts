import { Schema } from 'effect';

export const CallKeySchema = Schema.Struct({
  executionId: Schema.NonEmptyString,
  reference: Schema.String,
  run: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

export type CallKey = typeof CallKeySchema.Type;

export function callKeyText({ executionId, reference, run }: CallKey): string {
  return JSON.stringify([executionId, reference, run]);
}
