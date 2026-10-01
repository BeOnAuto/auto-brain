import type { Variables } from '../dsl/expressions.ts';
import { field, isObject, objectField, type Json, type JsonObject } from '../dsl/json.ts';
import { millisecondsOf } from './evaluation.ts';
import { raised } from './raised-error.ts';
import type { RunState } from './run-state.ts';

export interface Deadline {
  readonly milliseconds: number | undefined;
  readonly reference: string;
}

export interface TimeoutSite {
  readonly declared: Json | undefined;
  readonly data: Json;
  readonly variables: Variables;
  readonly reference: string;
}

export function timeoutOf(state: RunState, site: TimeoutSite): number | undefined {
  const { declared, data, variables, reference } = site;
  const timeout = timeoutDefinition(declared, state, reference);
  return timeout === undefined
    ? undefined
    : millisecondsOf(field(timeout, 'after') ?? null, data, variables, { reference, now: state.host.now() });
}

function timeoutDefinition(declared: Json | undefined, state: RunState, reference: string): JsonObject | undefined {
  if (typeof declared !== 'string') {
    return isObject(declared) ? declared : undefined;
  }
  const reused = objectField(state.components.timeouts, declared);
  if (reused === undefined) {
    throw raised('configuration', 400, `use.timeouts has no timeout ${declared}`, reference);
  }
  return reused;
}

export async function withTimeout<T>(state: RunState, deadline: Deadline, work: () => Promise<T>): Promise<T> {
  const { milliseconds, reference } = deadline;
  if (milliseconds === undefined) {
    return work();
  }
  const { host } = state;
  state.checkHistory(reference);
  const timer = host.cancellable(() => host.sleep(milliseconds, `${reference} timeout`));
  const job = host.cancellable(work);
  let expired = false;
  void timer.result.then(
    () => {
      expired = true;
      job.cancel();
      return expired;
    },
    () => expired,
  );
  try {
    return await job.result;
  } catch (error) {
    if (expired) {
      throw raised('timeout', 408, `The task did not finish within ${milliseconds} ms`, reference);
    }
    throw error;
  } finally {
    timer.cancel();
  }
}
