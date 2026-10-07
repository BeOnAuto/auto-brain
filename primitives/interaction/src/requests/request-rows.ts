import type { ProjectedRow } from '@beonauto/operations';
import { Option, Schema } from 'effect';

export const StandingSchema = Schema.Literals([
  'in_inbox',
  'to_deliver',
  'delivering',
  'delivered',
  'retrying',
  'undelivered',
  'answered',
  'cancelling',
]);

const OpenRequestRowSchema = Schema.Struct({
  request_id: Schema.String,
  function: Schema.String,
  version: Schema.Int,
  party: Schema.String,
  channel: Schema.String,
  message: Schema.String,
  answers: Schema.Boolean,
  requested_at: Schema.Int,
  expires_at: Schema.Int,
  attempts: Schema.Int,
  next_attempt_at: Schema.NullOr(Schema.Int),
  standing: StandingSchema,
  open: Schema.Boolean,
  due_at: Schema.NullOr(Schema.Int),
  ended: Schema.NullOr(Schema.String),
});

export type OpenRequestRow = typeof OpenRequestRowSchema.Type;

const decodeRow = Schema.decodeUnknownOption(OpenRequestRowSchema);

export const requestRowFrom: (row: ProjectedRow) => OpenRequestRow = Schema.decodeUnknownSync(OpenRequestRowSchema);

export function requestRowOf(row: ProjectedRow | undefined): OpenRequestRow | undefined {
  return row === undefined ? undefined : Option.getOrUndefined(decodeRow(row));
}

export function settlesFromDelivery({ answers, standing }: Pick<OpenRequestRow, 'answers' | 'standing'>): boolean {
  return standing === 'answered' || (!answers && standing === 'delivered');
}

export function dueAtOf(row: Omit<OpenRequestRow, 'due_at'>): number | null {
  if (!row.open || row.standing === 'cancelling') {
    return null;
  }
  const settlesNow = settlesFromDelivery(row) || (!row.answers && row.standing === 'undelivered');
  const attempt = row.next_attempt_at ?? Number.POSITIVE_INFINITY;
  return Math.min(row.expires_at, settlesNow ? row.requested_at : attempt);
}
