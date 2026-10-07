import { Context } from 'effect';

import type { Lineage } from '../ledger/message-lineage.ts';

export interface CallLink {
  readonly execution_id: string;
  readonly reference: string;
  readonly run: number;
}

export interface GivenLineage {
  readonly lineage: Lineage | null;
  readonly depth: number;
  readonly callDepth: number;
  readonly calledBy: CallLink | null;
}

export class CallLineage extends Context.Service<CallLineage, GivenLineage>()('@beonauto/operations/CallLineage') {}
