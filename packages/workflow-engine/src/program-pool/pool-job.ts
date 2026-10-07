import type { Option } from 'effect';

import type { Ending } from '../jobs/job-endings.ts';
import type { JobSchema } from '../jobs/job-envelopes.ts';

type Envelope = typeof JobSchema.Encoded;

export interface Job<Answer> {
  readonly module: Readonly<URL>;
  readonly envelope: (job: number) => Envelope;
  readonly decode: (answer: unknown) => Option.Option<Answer>;
}

export interface Running {
  readonly until: number;
  readonly signal?: Readonly<AbortSignal> | undefined;
}

export type Evaluate = <Answer>(job: Job<Answer>, running: Running) => Promise<Ending<Answer>>;
