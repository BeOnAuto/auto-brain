import type { ToolAccess } from '@beonauto/mcp';
import type { Lineage } from '@beonauto/operations';
import type { OutboundFetch } from '@beonauto/outbound';

import type { ChannelSettings } from '../channels/channel-settings.ts';
import type { RequestAddress } from '../delivery/attempt-end.ts';
import type { OpenRequestRow } from '../requests/request-rows.ts';
import type { RequestLedger } from './request-ledger.ts';

export interface DeliveryParts {
  readonly ledger: RequestLedger;
  readonly channels: ChannelSettings;
  readonly tools: Pick<ToolAccess, 'callOnce'>;
  readonly origin: string;
  readonly fetch?: OutboundFetch;
}

export interface DueRequest {
  readonly address: RequestAddress;
  readonly row: OpenRequestRow;
  readonly lineage: Lineage;
}
