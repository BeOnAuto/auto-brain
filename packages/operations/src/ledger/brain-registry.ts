import { Context, type Effect } from 'effect';

import type { PlaybookAddress } from '../caller/brain-context.ts';

export type PlaybookStatus = 'active' | 'retired' | 'unknown';

export class PlaybookRegistry extends Context.Service<
  PlaybookRegistry,
  {
    readonly status: (address: PlaybookAddress) => Effect.Effect<PlaybookStatus>;
  }
>()('@beonauto/operations/PlaybookRegistry') {}
