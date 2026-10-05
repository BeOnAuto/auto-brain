import { Context, type Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';

export type BrainStatus = 'active' | 'retired' | 'unknown';

export class BrainRegistry extends Context.Service<
  BrainRegistry,
  {
    readonly status: (address: BrainAddress) => Effect.Effect<BrainStatus>;
  }
>()('@beonauto/operations/BrainRegistry') {}
