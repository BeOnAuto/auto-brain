import { Context } from 'effect';

export interface BrainAddress {
  readonly org: string;
  readonly brain: string;
}

export class BrainContext extends Context.Service<BrainContext, BrainAddress>()('@beonauto/operations/BrainContext') {}
