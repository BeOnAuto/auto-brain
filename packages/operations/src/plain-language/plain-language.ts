import type { RejectionBecause } from '../outcome/rejection-because.ts';

export type Remedies = Readonly<Partial<Record<RejectionBecause, string>>>;

export interface PlainLanguage<Input, Output> {
  readonly task: string;
  readonly attempt: (input: Input) => string;
  readonly outcome: (output: Output, input: Input) => string;
  readonly remedies?: Remedies;
}

export interface RegisteredPlainLanguage {
  readonly attempt: (input: unknown) => string;
  readonly outcome: (output: unknown, input: unknown) => string;
  readonly remedies: Remedies;
}
