import { Schema } from 'effect';

import { CheckJobSchema } from './check-messages.ts';
import { FoldJobSchema } from './fold-messages.ts';
import { ProgramJobSchema } from './program-messages.ts';

export const JobSchema = Schema.Union([
  Schema.Struct({ job: Schema.Number, kind: Schema.Literal('program'), request: ProgramJobSchema }),
  Schema.Struct({
    job: Schema.Number,
    kind: Schema.Literal('fold'),
    request: FoldJobSchema,
    progress: Schema.instanceOf(SharedArrayBuffer),
  }),
  Schema.Struct({ job: Schema.Number, kind: Schema.Literal('check'), request: CheckJobSchema }),
]);

export type JobEnvelope = typeof JobSchema.Type;

export const JobAnswerSchema = Schema.Struct({ job: Schema.Number, answer: Schema.Unknown, keep: Schema.Boolean });

export const ReadySchema = Schema.Struct({ ready: Schema.Literal(true) });

export const readySignal: typeof ReadySchema.Type = { ready: true };

export type JobAnswer = typeof JobAnswerSchema.Type;
