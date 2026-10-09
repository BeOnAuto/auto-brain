import { brainCallerOf, type BrainAddress } from '@beonauto/operations';
import type { ReplyIdentity, Settlement } from '@beonauto/specs';
import type { Schema } from 'effect';

import { throughWords, type Route } from '../route/routes.ts';

export function expiredSettlement({ expires_at: expiresAt }: { readonly expires_at: number }): Settlement {
  return {
    status: 'rejected',
    reason: 'unanswered',
    kind: 'expired',
    detail: `Nobody answered the request before it expired at ${new Date(expiresAt).toISOString()}`,
  };
}

export interface BroughtAnswer {
  readonly answer: Schema.Json;
  readonly at: string;
  readonly reply: ReplyIdentity;
}

export function answeredSettlement(brain: BrainAddress, { answer, at, reply }: BroughtAnswer): Settlement {
  const by = brainCallerOf(brain).id;
  return { status: 'succeeded', output: answer, record: { answered_by: by, answered_at: at, reply }, by };
}

export function deliveredSettlement(at: string): Settlement {
  return { status: 'succeeded', output: {}, record: { delivered_at: at } };
}

export function undeliveredSettlement(route: Route): Settlement {
  return {
    status: 'rejected',
    reason: 'unanswered',
    kind: 'undelivered',
    detail: `The notification could not be delivered ${throughWords(route)}, though every attempt was made`,
  };
}
