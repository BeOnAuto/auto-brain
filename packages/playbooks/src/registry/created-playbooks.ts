import { Option, Schema } from 'effect';

import { PlaybookEventSchema } from './playbook-events.ts';

const decodePlaybookEvent = Schema.decodeUnknownOption(Schema.toCodecJson(PlaybookEventSchema));

export function playbookCreatedOf(data: unknown): string | undefined {
  return Option.getOrUndefined(
    Option.flatMap(decodePlaybookEvent(data), (event) =>
      event.type === 'playbook_created' ? Option.some(event.playbook) : Option.none(),
    ),
  );
}
