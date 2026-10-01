import { Context, type Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-scope.ts';

export class BrainDirectory extends Context.Service<
  BrainDirectory,
  {
    readonly exists: (address: BrainAddress) => Effect.Effect<boolean>;
  }
>()('@beonauto/operations/BrainDirectory') {}
