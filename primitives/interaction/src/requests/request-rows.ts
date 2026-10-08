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
  answer_schema: Schema.NullOr(Schema.String),
  requested_at: Schema.Int,
  expires_at: Schema.Int,
  attempts: Schema.Int,
  next_attempt_at: Schema.NullOr(Schema.Int),
  standing: StandingSchema,
  open: Schema.Boolean,
  attempt_due_at: Schema.NullOr(Schema.Int),
  ending_due_at: Schema.NullOr(Schema.Int),
  ended: Schema.NullOr(Schema.String),
});

export type OpenRequestRow = typeof OpenRequestRowSchema.Type;

const decodeRow = Schema.decodeUnknownOption(OpenRequestRowSchema);

export const requestRowFrom: (row: ProjectedRow) => OpenRequestRow = Schema.decodeUnknownSync(OpenRequestRowSchema);

export function requestRowOf(row: ProjectedRow | undefined): OpenRequestRow | undefined {
  return row === undefined ? undefined : Option.getOrUndefined(decodeRow(row));
}

export function settlesFromChannel({ answers, standing }: Pick<OpenRequestRow, 'answers' | 'standing'>): boolean {
  return standing === 'answered' || (!answers && standing === 'delivered');
}

export type UndueRequestRow = Omit<OpenRequestRow, 'attempt_due_at' | 'ending_due_at'>;

function settlesNow(row: UndueRequestRow): boolean {
  return settlesFromChannel(row) || (!row.answers && row.standing === 'undelivered');
}

function stillDue(row: UndueRequestRow): boolean {
  return row.open && row.standing !== 'cancelling';
}

export function attemptDueAtOf(row: UndueRequestRow): number | null {
  const awaitsAttempt = row.standing === 'to_deliver' || row.standing === 'retrying';
  return stillDue(row) && awaitsAttempt ? row.next_attempt_at : null;
}

export function endingDueAtOf(row: UndueRequestRow): number | null {
  if (!stillDue(row)) {
    return null;
  }
  if (settlesNow(row)) {
    return row.requested_at;
  }
  const lostAt = row.standing === 'delivering' ? row.next_attempt_at : null;
  return Math.min(row.expires_at, lostAt ?? Number.POSITIVE_INFINITY);
}
