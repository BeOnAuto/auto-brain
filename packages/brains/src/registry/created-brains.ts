import { recordedDecoder } from '@beonauto/operations';
import { Option } from 'effect';

import { BrainEventSchema } from './brain-events.ts';

const decodeBrainEvent = recordedDecoder(BrainEventSchema);

export function brainCreatedOf(recorded: unknown): string | undefined {
  return Option.getOrUndefined(
    Option.flatMap(decodeBrainEvent(recorded), (event) =>
      event.type === 'brain_created' ? Option.some(event.data.brain) : Option.none(),
    ),
  );
}
