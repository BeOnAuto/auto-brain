export interface PlainLanguage<Input, Output> {
  readonly task: string;
  readonly attempt: (input: Input) => string;
  readonly outcome: (output: Output, input: Input) => string;
}

export interface RegisteredPlainLanguage {
  readonly attempt: (input: unknown) => string;
  readonly outcome: (output: unknown, input: unknown) => string;
}
