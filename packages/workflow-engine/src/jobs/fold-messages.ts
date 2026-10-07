import { Schema } from 'effect';

import { DialectSchema, LimitsSchema, SpanSchema } from './program-messages.ts';

const StallSchema = Schema.Struct({
  at: Schema.Number,
  kind: Schema.Literals(['raised', 'none', 'several', 'work', 'depth', 'unfit', 'size', 'schema', 'refused']),
  message: Schema.String,
  span: Schema.NullOr(SpanSchema),
});

export const FoldJobSchema = Schema.Struct({
  events: Schema.String,
  views: Schema.Array(
    Schema.Struct({
      fold: Schema.String,
      filters: Schema.Array(Schema.JsonObject),
      view: Schema.String,
      schema: Schema.optionalKey(Schema.JsonObject),
      events: Schema.Array(Schema.Number),
    }),
  ),
  dialect: DialectSchema,
  variable: Schema.String,
  limits: LimitsSchema,
  foldDeadlineMs: Schema.Number,
  pageBudgetMs: Schema.Number,
  mostViewBytes: Schema.Number,
});

export type FoldJob = typeof FoldJobSchema.Type;

export const FoldAnswerSchema = Schema.Union([
  Schema.Struct({
    ran: Schema.Literal('folded'),
    early: Schema.Boolean,
    views: Schema.Array(
      Schema.Struct({
        view: Schema.fromJsonString(Schema.Json),
        folded: Schema.Number,
        lastFolded: Schema.Number,
        through: Schema.Number,
        work: Schema.Number,
        stall: Schema.optionalKey(StallSchema),
        overtime: Schema.optionalKey(Schema.Number),
      }),
    ),
  }),
  Schema.Struct({ ran: Schema.Literal('unreadable') }),
]);

export type FoldAnswer = typeof FoldAnswerSchema.Type;
