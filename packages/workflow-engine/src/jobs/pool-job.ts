import type { Option } from 'effect';

import type { Ending } from './job-endings.ts';
import type { JobSchema } from './job-envelopes.ts';

type Envelope = typeof JobSchema.Encoded;

export interface Job<Answer> {
  readonly module: Readonly<URL>;
  readonly envelope: (job: number) => Envelope;
  readonly decode: (answer: unknown) => Option.Option<Answer>;
}

export interface Running {
  readonly until: number;
  readonly signal?: Readonly<AbortSignal> | undefined;
  readonly afterReady?: number;
}

export type Evaluate = <Answer>(job: Job<Answer>, running: Running) => Promise<Ending<Answer>>;
