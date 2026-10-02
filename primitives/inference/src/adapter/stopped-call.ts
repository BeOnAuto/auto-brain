import { Cancelled } from '../failure/cancelled.ts';
import type { ModelFailure } from '../failure/model-failure.ts';
import { TimedOut } from '../failure/timed-out.ts';
import type { ModelRequest } from '../model/model-request.ts';

export interface Deadline {
  readonly signal: AbortSignal;
  readonly ms: number;
}

export function deadlineOf(request: ModelRequest): Deadline | undefined {
  return request.timeout_ms === undefined
    ? undefined
    : { signal: AbortSignal.timeout(request.timeout_ms), ms: request.timeout_ms };
}

export function stoppedFailure(
  provider: string,
  request: ModelRequest,
  deadline: Deadline | undefined,
): ModelFailure | undefined {
  if (deadline?.signal.aborted === true) {
    return new TimedOut({
      detail: `${provider} did not answer within ${deadline.ms} ms`,
      provider,
      timeout_ms: deadline.ms,
    });
  }
  return request.signal?.aborted === true
    ? new Cancelled({ detail: `The call to ${provider} was cancelled`, provider })
    : undefined;
}
