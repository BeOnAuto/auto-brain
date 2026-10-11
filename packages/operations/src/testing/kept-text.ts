import { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';
import type { RecordedContent } from '../content/recorded-content.ts';
import { textOfContent } from '../content/streamed-content.ts';

export function keptTextOf(
  content: Pick<RecordedContent, 'get'>,
  brain: BrainAddress,
  sha256: string,
): Promise<string | undefined> {
  return Effect.runPromise(
    Effect.flatMap(content.get(brain, sha256), (kept) =>
      kept === undefined ? Effect.succeed(kept) : textOfContent(kept),
    ),
  );
}
