import type { RecordWork } from '@on.auto/definitions';
import type { ToolAccess } from '@on.auto/mcp';
import type { Lineage } from '@on.auto/operations';

import type { RequestAddress } from '../delivery/attempt-end.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import type { RequestLedger } from './request-ledger.ts';

export interface DeliveryParts {
  readonly ledger: RequestLedger;
  readonly tools: Pick<ToolAccess, 'startOf' | 'callOnce'>;
  readonly record: RecordWork;
}

export interface DueRequest {
  readonly address: RequestAddress;
  readonly row: OpenRequestRow;
  readonly lineage: Lineage;
}
