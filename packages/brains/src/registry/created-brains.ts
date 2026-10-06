import { Option, Schema } from 'effect';

import { BrainEventSchema } from './brain-events.ts';

const decodeBrainEvent = Schema.decodeUnknownOption(Schema.toCodecJson(BrainEventSchema));

export function brainCreatedOf(data: unknown): string | undefined {
  return Option.getOrUndefined(
    Option.flatMap(decodeBrainEvent(data), (event) =>
      event.type === 'brain_created' ? Option.some(event.brain) : Option.none(),
    ),
  );
}
