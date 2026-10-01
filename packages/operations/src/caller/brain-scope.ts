import { Context } from 'effect';

export interface BrainAddress {
  readonly org: string;
  readonly brain: string;
}

export class BrainScope extends Context.Service<BrainScope, BrainAddress>()('@beonauto/operations/BrainScope') {}
