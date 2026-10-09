import type { ToolAccess } from '@beonauto/mcp';
import type { Lineage } from '@beonauto/operations';

import type { RequestAddress } from '../delivery/attempt-end.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import type { RequestLedger } from './request-ledger.ts';

export interface DeliveryParts {
  readonly ledger: RequestLedger;
  readonly tools: Pick<ToolAccess, 'startOf' | 'callOnce'>;
}

export interface DueRequest {
  readonly address: RequestAddress;
  readonly row: OpenRequestRow;
  readonly lineage: Lineage;
}
