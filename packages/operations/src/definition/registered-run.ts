import type { Effect } from 'effect';

import type { StreamedContent } from '../content/streamed-content.ts';
import type { Rejected, Succeeded } from '../outcome/outcome.ts';

export type InputEncoding = 'json' | 'strings';

export type RegisteredRun<Services> = (
  input: unknown,
  encoding: InputEncoding,
  body?: StreamedContent,
) => Effect.Effect<Succeeded, Rejected, Services>;
