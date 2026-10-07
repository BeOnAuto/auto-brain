import type { Settlement } from '@beonauto/specs';

import type { OpenRequestRow } from '../requests/request-rows.ts';

export function expiredSettlement(row: Pick<OpenRequestRow, 'expires_at'>): Settlement {
  return {
    status: 'rejected',
    reason: 'unanswered',
    kind: 'expired',
    detail: `Nobody answered the request before it expired at ${new Date(row.expires_at).toISOString()}`,
  };
}

export function undeliveredSettlement(row: Pick<OpenRequestRow, 'channel'>): Settlement {
  return {
    status: 'rejected',
    reason: 'unanswered',
    kind: 'undelivered',
    detail: `The notification could not be delivered through the channel “${row.channel}”, though every attempt was made`,
  };
}
