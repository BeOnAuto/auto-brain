import type { UnavailableBecause } from '../outcome/unavailable.ts';

export type Remedies = Readonly<Partial<Record<UnavailableBecause, string>>>;

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
