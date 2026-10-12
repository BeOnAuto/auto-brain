import { recordedDecoder } from '@beonauto/operations';
import { Option } from 'effect';

import { PlaybookEventSchema } from './brain-events.ts';

const decodePlaybookEvent = recordedDecoder(PlaybookEventSchema);

export function playbookCreatedOf(recorded: unknown): string | undefined {
  return Option.getOrUndefined(
    Option.flatMap(decodePlaybookEvent(recorded), (event) =>
      event.type === 'brain_created' ? Option.some(event.data.brain) : Option.none(),
    ),
  );
}
