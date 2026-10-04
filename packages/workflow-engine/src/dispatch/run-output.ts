import { Schema } from 'effect';

import { CallKeySchema } from '../executor/call-key.ts';
import { RunSettlementSchema } from '../settlement/run-settlement.ts';
import { TimerPurposeSchema } from '../timers/timer-id.ts';

const ExecutionIdSchema = Schema.NonEmptyString;

const MillisecondsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const ArmTimerSchema = Schema.Struct({
  kind: Schema.Literal('arm_timer'),
  executionId: ExecutionIdSchema,
  timerId: Schema.NonEmptyString,
  dueAt: MillisecondsSchema,
  purpose: TimerPurposeSchema,
});

const CancelTimerSchema = Schema.Struct({
  kind: Schema.Literal('cancel_timer'),
  executionId: ExecutionIdSchema,
  timerId: Schema.NonEmptyString,
});

const StartCallSchema = Schema.Struct({
  kind: Schema.Literal('start_call'),
  key: CallKeySchema,
  function: Schema.NonEmptyString,
  arguments: Schema.Json,
  longestMs: MillisecondsSchema,
});

const CancelCallSchema = Schema.Struct({
  kind: Schema.Literal('cancel_call'),
  key: CallKeySchema,
});

const SettleSchema = Schema.Struct({
  kind: Schema.Literal('settle'),
  executionId: ExecutionIdSchema,
  settlement: RunSettlementSchema,
});

export const RunOutputSchema = Schema.Union([
  ArmTimerSchema,
  CancelTimerSchema,
  StartCallSchema,
  CancelCallSchema,
  SettleSchema,
]);

export type ArmTimer = typeof ArmTimerSchema.Type;

export type CancelTimer = typeof CancelTimerSchema.Type;

export type StartCall = typeof StartCallSchema.Type;

export type CancelCall = typeof CancelCallSchema.Type;

export type Settle = typeof SettleSchema.Type;

export type RunOutput = typeof RunOutputSchema.Type;
