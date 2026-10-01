import { Context } from 'effect';

import type { BrainAccess } from './brain-access.ts';
import type { Permission } from './permission.ts';

export interface CallerIdentity {
  readonly id: string;
  readonly org: string;
  readonly permissions: readonly Permission[];
  readonly brains: BrainAccess;
}

export class Caller extends Context.Service<Caller, CallerIdentity>()('@beonauto/operations/Caller') {}
