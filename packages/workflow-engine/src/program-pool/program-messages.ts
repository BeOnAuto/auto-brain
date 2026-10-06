import { Schema } from 'effect';

const IssueSchema = Schema.Struct({
  detail: Schema.String,
  span: Schema.Struct({ start: Schema.Number, end: Schema.Number }),
  error: Schema.optionalKey(Schema.String),
});

export const ProgramAnswerSchema = Schema.Union([
  Schema.Struct({
    ran: Schema.Literal('answered'),
    output: Schema.fromJsonString(Schema.Json),
    bytes: Schema.Number,
    work: Schema.Number,
  }),
  Schema.Struct({ ran: Schema.Literal('oversized'), work: Schema.Number }),
  Schema.Struct({ ran: Schema.Literal('raised'), issue: IssueSchema, work: Schema.Number }),
  Schema.Struct({
    ran: Schema.Literal('exhausted'),
    limit: Schema.Literals(['work', 'deadline', 'value depth']),
    issue: IssueSchema,
    work: Schema.Number,
  }),
  Schema.Struct({ ran: Schema.Literal('unanswered'), outputs: Schema.Number, work: Schema.Number }),
  Schema.Struct({ ran: Schema.Literal('unfit'), work: Schema.Number }),
  Schema.Struct({ ran: Schema.Literal('refused'), issues: Schema.Array(IssueSchema) }),
]);

export type ProgramAnswer = typeof ProgramAnswerSchema.Type;
