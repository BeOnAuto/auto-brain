import { Schema } from 'effect';

export const SettlementSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Json }),
  Schema.Struct({
    status: Schema.Literal('rejected'),
    reason: Schema.Literals(['invalid_input', 'unavailable']),
    detail: Schema.String,
  }),
  Schema.Struct({ status: Schema.Literal('failed') }),
]);

export type Settlement = typeof SettlementSchema.Type;
