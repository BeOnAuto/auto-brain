import { Schema } from 'effect';

const SpanSchema = Schema.Struct({ start: Schema.Number, end: Schema.Number });

const StallSchema = Schema.Struct({
  at: Schema.Number,
  kind: Schema.Literals(['raised', 'none', 'several', 'work', 'depth', 'unfit', 'size', 'schema', 'refused']),
  message: Schema.String,
  span: Schema.NullOr(SpanSchema),
});

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
