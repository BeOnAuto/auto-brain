import { RunContextSchema, type RunContext } from '@beonauto/operations';
import { Option, Schema } from 'effect';

const decodeStart = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.Literal('run_started'), context: RunContextSchema }),
);

export function runStartedOf(recorded: unknown): RunContext | undefined {
  return Option.getOrUndefined(Option.map(decodeStart(recorded), ({ context }) => context));
}
