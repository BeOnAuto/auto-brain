import { CallResultSchema } from '@beonauto/operations';
import { Schema } from 'effect';

import { CallKeySchema } from '../executor/call-key.ts';
import { ReceivedEventSchema } from '../inbox/received-event.ts';
import { InstantSchema } from './instant.ts';
import { mostEventIdLength } from './limits.ts';

const ExecutionIdSchema = Schema.NonEmptyString;

const PositiveMillisecondsSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const RunLimitsSchema = Schema.Struct({
  mostDurationMs: PositiveMillisecondsSchema,
  longestCallMs: PositiveMillisecondsSchema,
  longestCallMsByTask: Schema.optionalKey(Schema.Record(Schema.String, PositiveMillisecondsSchema)),
});

export const CancelOrderSchema = Schema.Struct({
  by: Schema.NonEmptyString,
  kind: Schema.Literals(['requested', 'deadline', 'parent_ended']),
  reason: Schema.String,
});

const StartedSchema = Schema.Struct({
  kind: Schema.Literal('started'),
  executionId: ExecutionIdSchema,
  at: InstantSchema,
  document: Schema.JsonObject,
  input: Schema.Json,
  limits: RunLimitsSchema,
  attributes: Schema.JsonObject,
  seed: Schema.Int,
});

const TimerFiredSchema = Schema.Struct({
  kind: Schema.Literal('timer_fired'),
  executionId: ExecutionIdSchema,
  at: InstantSchema,
  timerId: Schema.NonEmptyString,
});

const CallAnsweredSchema = Schema.Struct({
  kind: Schema.Literal('call_answered'),
  executionId: ExecutionIdSchema,
  at: InstantSchema,
  key: CallKeySchema,
  result: CallResultSchema,
});

const EventReceivedSchema = Schema.Struct({
  kind: Schema.Literal('event_received'),
  executionId: ExecutionIdSchema,
  at: InstantSchema,
  event: ReceivedEventSchema,
});

const OfferKeySchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(mostEventIdLength));

const EventOfferedSchema = Schema.Struct({
  kind: Schema.Literal('event_offered'),
  executionId: ExecutionIdSchema,
  at: InstantSchema,
  key: OfferKeySchema,
  listener: CallKeySchema,
  event: ReceivedEventSchema,
});

const CancelRequestedSchema = Schema.Struct({
  kind: Schema.Literal('cancel_requested'),
  executionId: ExecutionIdSchema,
  at: InstantSchema,
  cancel: CancelOrderSchema,
  cause: Schema.optionalKey(Schema.NonEmptyString),
});

export const RunInputSchema = Schema.Union([
  StartedSchema,
  TimerFiredSchema,
  CallAnsweredSchema,
  EventReceivedSchema,
  EventOfferedSchema,
  CancelRequestedSchema,
]);

export type RunLimits = typeof RunLimitsSchema.Type;

export type CancelOrder = typeof CancelOrderSchema.Type;

export type Started = typeof StartedSchema.Type;

export type TimerFired = typeof TimerFiredSchema.Type;

export type CallAnswered = typeof CallAnsweredSchema.Type;

export type EventReceived = typeof EventReceivedSchema.Type;

export type EventOffered = typeof EventOfferedSchema.Type;

export type CancelRequested = typeof CancelRequestedSchema.Type;

export type RunInput = typeof RunInputSchema.Type;

export type RunInputKind = RunInput['kind'];
