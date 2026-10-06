import { Context } from 'effect';

import type { Lineage } from '../ledger/message-lineage.ts';

export interface GivenLineage {
  readonly lineage: Lineage | null;
  readonly depth: number;
}

export class CallLineage extends Context.Service<CallLineage, GivenLineage>()('@beonauto/operations/CallLineage') {}
