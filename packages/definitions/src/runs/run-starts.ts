import { ContextSchema, type Context } from '@beonauto/operations';
import { Option, Schema } from 'effect';

const decodeStart = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.Literal('run_started'), context: ContextSchema }),
);

export function runStartedOf(recorded: unknown): Context | undefined {
  return Option.getOrUndefined(Option.map(decodeStart(recorded), ({ context }) => context));
}
