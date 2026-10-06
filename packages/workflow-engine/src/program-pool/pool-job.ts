import type { Option } from 'effect';

export type Stopped = 'deadline' | 'memory' | 'busy' | 'cancelled' | 'closing';

export type Interrupted =
  | { readonly ran: 'stopped'; readonly because: Stopped }
  | { readonly ran: 'crashed'; readonly detail: string };

export type Ending<Answer> = Answer | Interrupted;

export interface Job<Answer> {
  readonly module: Readonly<URL>;
  readonly workerData: unknown;
  readonly decode: (message: unknown) => Option.Option<Answer>;
}

export interface Running {
  readonly until: number;
  readonly signal?: Readonly<AbortSignal> | undefined;
}

export type Evaluate = <Answer>(job: Job<Answer>, running: Running) => Promise<Ending<Answer>>;

export function stopped(because: Stopped): Interrupted {
  return { ran: 'stopped', because };
}

export function isInterrupted<Answer extends { readonly ran: string }>(ending: Ending<Answer>): ending is Interrupted {
  return ending.ran === 'stopped' || ending.ran === 'crashed';
}
