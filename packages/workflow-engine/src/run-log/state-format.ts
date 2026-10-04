import { Schema } from 'effect';

export const stateFormat = 1;

export const StateFormatSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export interface OlderFormat {
  readonly format: number;
  readonly initial: unknown;
  readonly read: (state: unknown) => unknown;
  readonly upcast: (state: unknown) => unknown;
}

export interface StateFormats {
  readonly current: number;
  readonly older: readonly OlderFormat[];
}

export const stateFormats: StateFormats = { current: stateFormat, older: [] };
