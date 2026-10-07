import { Schema } from 'effect';

export const SpanSchema = Schema.Struct({ start: Schema.Number, end: Schema.Number });

const IssueSchema = Schema.Struct({
  detail: Schema.String,
  span: SpanSchema,
  error: Schema.optionalKey(Schema.String),
});

export const DialectSchema = Schema.Struct({
  refused: Schema.Array(Schema.Struct({ name: Schema.String, why: Schema.String })),
  variables: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const LimitsSchema = Schema.Struct({
  mostWork: Schema.Number,
  mostSteps: Schema.Number,
  mostDepth: Schema.Number,
  mostOutputs: Schema.Number,
  mostValueDepth: Schema.Number,
});

export const ProgramJobSchema = Schema.Struct({
  source: Schema.String,
  input: Schema.String,
  variables: Schema.String,
  dialect: DialectSchema,
  limits: LimitsSchema,
  mostOutputBytes: Schema.Number,
  deadlineAt: Schema.Number,
  context: Schema.Json,
});

export type ProgramJob = typeof ProgramJobSchema.Type;

export const ProgramAnswerSchema = Schema.Union([
  Schema.Struct({
    ran: Schema.Literal('answered'),
    output: Schema.fromJsonString(Schema.Json),
    bytes: Schema.Number,
    work: Schema.Number,
  }),
  Schema.Struct({ ran: Schema.Literal('oversized'), work: Schema.Number }),
  Schema.Struct({
    ran: Schema.Literal('mismatched'),
    issues: Schema.Array(Schema.Struct({ pointer: Schema.String, detail: Schema.String })),
    work: Schema.Number,
  }),
  Schema.Struct({ ran: Schema.Literal('raised'), issue: IssueSchema, work: Schema.Number }),
  Schema.Struct({
    ran: Schema.Literal('exhausted'),
    limit: Schema.Literals(['work', 'deadline', 'value depth', 'depth', 'stack']),
    issue: IssueSchema,
    work: Schema.Number,
  }),
  Schema.Struct({ ran: Schema.Literal('unanswered'), outputs: Schema.Number, work: Schema.Number }),
  Schema.Struct({ ran: Schema.Literal('unfit'), work: Schema.Number }),
  Schema.Struct({ ran: Schema.Literal('refused'), issues: Schema.Array(IssueSchema) }),
]);

export type ProgramAnswer = typeof ProgramAnswerSchema.Type;
