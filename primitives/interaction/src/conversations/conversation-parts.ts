import type { ToolAccess } from '@beonauto/mcp';
import type { BrainAddress, ProjectionAdvancer, ProjectionReader } from '@beonauto/operations';
import type { Effect } from 'effect';

import type { Replies } from '../route/route-schemas.ts';
import type { RequestLedger } from '../schedule/request-ledger.ts';
import { advancedOf, conversationsName, type Cadence, type ConversationRow } from './conversation-rows.ts';

export interface ConversationLedger
  extends RequestLedger, Pick<ProjectionReader, 'readProjectedRows'>, ProjectionAdvancer {}

export interface ConversationParts {
  readonly ledger: ConversationLedger;
  readonly tools: Pick<ToolAccess, 'startOf' | 'callOnce'>;
}

export interface ConversationPlace {
  readonly brain: BrainAddress;
  readonly key: string;
  readonly row: ConversationRow;
}

export interface ReadingRoute {
  readonly server: string;
  readonly delivering: string;
  readonly replies: Replies;
}

export function advanced(
  parts: ConversationParts,
  { brain, key }: ConversationPlace,
  cadence: Cadence,
): Effect.Effect<void> {
  return parts.ledger.advanceRow(conversationsName, brain, key, advancedOf(cadence));
}

export function cadenceOf({ row }: ConversationPlace): Cadence {
  return { open: row.open, active_at: row.active_at, reads: row.reads, next_read_at: row.next_read_at };
}

export function resting({ row }: ConversationPlace): Cadence {
  return { open: false, active_at: row.active_at, reads: row.reads, next_read_at: null };
}
