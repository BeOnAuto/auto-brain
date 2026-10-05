import type { Variables } from '@beonauto/workflow-engine/dsl/expressions';
import type { Json } from '@beonauto/workflow-engine/dsl/json';
import { timedOut, timeoutMilliseconds } from '@beonauto/workflow-engine/dsl/task-outcomes';

import { placeIn, type RunState } from './run-state.ts';

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
  return timeoutMilliseconds(declared, state.components.timeouts, {
    data,
    variables,
    place: placeIn(state, reference),
  });
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
      throw timedOut(milliseconds, reference);
    }
    throw error;
  } finally {
    timer.cancel();
  }
}
