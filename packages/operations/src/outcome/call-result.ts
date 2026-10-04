import { Schema } from 'effect';

export const invalidArguments = 'invalid_arguments';

export const CallResultSchema = Schema.Union([
  Schema.Struct({ status: Schema.Literal('succeeded'), output: Schema.Json }),
  Schema.Struct({ status: Schema.Literal('rejected'), reason: Schema.String, detail: Schema.String }),
  Schema.Struct({ status: Schema.Literal('failed'), detail: Schema.String }),
  Schema.Struct({ status: Schema.Literal('unreachable'), detail: Schema.String }),
]);

export type CallResult = typeof CallResultSchema.Type;

export type CallStatus = CallResult['status'];
