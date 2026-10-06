import { Option, Schema } from 'effect';

import { ExecutionEventSchema } from './execution-events.ts';

export interface RunStarted {
  readonly primitive: string;
  readonly name: string;
  readonly depth: number;
}

const decodeExecutionEvent = Schema.decodeUnknownOption(Schema.toCodecJson(ExecutionEventSchema));

export function runStartedOf(data: unknown): RunStarted | undefined {
  return Option.getOrUndefined(
    Option.flatMap(decodeExecutionEvent(data), (event) =>
      event.type === 'execution_started'
        ? Option.some({ primitive: event.primitive, name: event.name, depth: event.depth ?? 0 })
        : Option.none(),
    ),
  );
}
