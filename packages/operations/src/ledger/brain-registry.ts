import { Context, type Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';

export class BrainRegistry extends Context.Service<
  BrainRegistry,
  {
    readonly exists: (address: BrainAddress) => Effect.Effect<boolean>;
  }
>()('@beonauto/operations/BrainRegistry') {}
