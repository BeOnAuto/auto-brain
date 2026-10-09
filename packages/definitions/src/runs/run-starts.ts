import { Option, Schema } from 'effect';

import { RunEventSchema } from './run-events.ts';

export interface StartedRun {
  readonly definitionType: string;
  readonly name: string;
  readonly depth: number;
}

const decodeRunEvent = Schema.decodeUnknownOption(Schema.toCodecJson(RunEventSchema));

export function runStartedOf(data: unknown): StartedRun | undefined {
  return Option.getOrUndefined(
    Option.flatMap(decodeRunEvent(data), (event) =>
      event.type === 'run_started'
        ? Option.some({ definitionType: event.definition_type, name: event.name, depth: event.depth ?? 0 })
        : Option.none(),
    ),
  );
}
