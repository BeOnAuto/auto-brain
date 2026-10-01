import type { Variables } from '../dsl/expressions.ts';
import { field, isObject, objectField, type Json, type JsonObject } from '../dsl/json.ts';
import { holds, millisecondsOf } from './evaluation.ts';
import type { Place } from './invocation.ts';
import { raised } from './raised-error.ts';
import type { RunState } from './run-state.ts';

export interface RetryState {
  readonly attempt: number;
  readonly startedAt: number;
}

export interface RetryContext {
  readonly state: RunState;
  readonly data: Json;
  readonly variables: Variables;
  readonly place: Place;
}

export function retryPolicyOf(declared: Json | undefined, state: RunState, reference: string): JsonObject | undefined {
  if (typeof declared !== 'string') {
    return isObject(declared) ? declared : undefined;
  }
  const reused = objectField(state.components.retries, declared);
  if (reused === undefined) {
    throw raised('configuration', 400, `use.retries has no retry policy ${declared}`, reference);
  }
  return reused;
}

export function attemptDuration(policy: JsonObject | undefined, context: RetryContext): number | undefined {
  const duration = field(objectField(objectField(policy ?? {}, 'limit') ?? {}, 'attempt') ?? {}, 'duration');
  return duration === undefined ? undefined : durationOf(duration, context);
}

export function retryDelay(policy: JsonObject, retry: RetryState, context: RetryContext): number | undefined {
  const { data, variables, place, state } = context;
  if (!holds(field(policy, 'when'), data, variables, place) || !holdsNot(field(policy, 'exceptWhen'), context)) {
    return undefined;
  }
  const limit = objectField(policy, 'limit') ?? {};
  const count = field(objectField(limit, 'attempt') ?? {}, 'count');
  if (typeof count === 'number' && retry.attempt >= count) {
    return undefined;
  }
  const total = field(limit, 'duration');
  if (total !== undefined && state.host.now() - retry.startedAt >= durationOf(total, context)) {
    return undefined;
  }
  return backoff(policy, retry.attempt, context) + jitter(objectField(policy, 'jitter'), context);
}

function holdsNot(condition: Json | undefined, context: RetryContext): boolean {
  return condition === undefined || !holds(condition, context.data, context.variables, context.place);
}

function backoff(policy: JsonObject, attempt: number, context: RetryContext): number {
  const delay = durationOf(field(policy, 'delay') ?? { seconds: 0 }, context);
  const strategy = objectField(policy, 'backoff') ?? {};
  if (field(strategy, 'exponential') !== undefined) {
    return delay * 2 ** attempt;
  }
  return field(strategy, 'linear') === undefined ? delay : delay * (attempt + 1);
}

function jitter(range: JsonObject | undefined, context: RetryContext): number {
  if (range === undefined) {
    return 0;
  }
  const from = durationOf(field(range, 'from') ?? { seconds: 0 }, context);
  const to = durationOf(field(range, 'to') ?? { seconds: 0 }, context);
  return Math.round(from + context.state.host.random() * Math.max(to - from, 0));
}

function durationOf(duration: Json, { data, variables, place }: RetryContext): number {
  return millisecondsOf(duration, data, variables, place);
}
