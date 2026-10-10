import { Option, Schema } from 'effect';

import { BrainEventSchema } from './brain-events.ts';

const decodeBrainEvent = Schema.decodeUnknownOption(Schema.toCodecJson(BrainEventSchema));

export function brainCreatedOf(recorded: { readonly type: string; readonly data: unknown }): string | undefined {
  const { type, data } = recorded;
  return Option.getOrUndefined(
    Option.flatMap(decodeBrainEvent({ type, data }), (event) =>
      event.type === 'brain_created' ? Option.some(event.data.brain) : Option.none(),
    ),
  );
}
