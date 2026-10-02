import type { WorkflowHost } from '../interpreter/host.ts';
import { mostSettleAttempts, type OrchestrationActivities } from './activity-contract.ts';

interface RetrySettings {
  readonly initialInterval: string;
  readonly backoffCoefficient: number;
  readonly maximumInterval: string;
  readonly maximumAttempts: number;
}

export interface ActivitySettings {
  readonly activityId: string;
  readonly summary: string;
  readonly startToCloseTimeout: number;
  readonly heartbeatTimeout: string;
  readonly retry: RetrySettings;
}

export interface LocalActivitySettings {
  readonly summary: string;
  readonly startToCloseTimeout: string;
  readonly localRetryThreshold: string;
  readonly retry: RetrySettings;
}

export interface TemporalScope {
  run<T>(work: () => Promise<T>): Promise<T>;
  cancel(): void;
}

export interface TemporalScopes {
  new (): TemporalScope;
  nonCancellable<T>(work: () => Promise<T>): Promise<T>;
}

export interface EventSignal {
  readonly type: 'signal';
  readonly name: string;
}

export interface WorkflowApi {
  readonly CancellationScope: TemporalScopes;
  readonly ApplicationFailure: {
    create(failure: { readonly type: string; readonly message: string; readonly nonRetryable: boolean }): Error;
  };
  readonly log: {
    error(message: string, attributes: Readonly<Record<string, string>>): void;
  };
  sleep(milliseconds: number, options: { readonly summary: string }): Promise<void>;
  condition(satisfied: () => boolean): Promise<void>;
  proxyActivities(options: ActivitySettings): OrchestrationActivities;
  proxyLocalActivities(options: LocalActivitySettings): OrchestrationActivities;
  isCancellation(error: unknown): boolean;
  workflowInfo(): { readonly historySize: number; readonly historyLength: number };
  defineSignal(name: string): EventSignal;
  setHandler(signal: EventSignal, handler: (event: unknown) => void): void;
}

const retryTransientFailures = {
  initialInterval: '1 second',
  backoffCoefficient: 2,
  maximumInterval: '1 minute',
  maximumAttempts: 5,
};

const nestedExecutionMarginMs = 60_000;

const nestedHeartbeatTimeout = '30 seconds';

export const settleSettings: LocalActivitySettings = {
  summary: 'settle the execution',
  startToCloseTimeout: '1 minute',
  localRetryThreshold: '1 second',
  retry: { ...retryTransientFailures, maximumAttempts: mostSettleAttempts },
};

export function temporalHost(api: WorkflowApi): WorkflowHost {
  return {
    now: () => Date.now(),
    random: () => Math.random(),
    historySize: () => {
      const { historySize, historyLength } = api.workflowInfo();
      return { bytes: historySize, events: historyLength };
    },
    sleep: (milliseconds, summary) => api.sleep(milliseconds, { summary }),
    deadline: (milliseconds) => api.sleep(milliseconds, { summary: 'the most the workflow may run' }),
    waitUntil: (satisfied) => api.condition(satisfied),
    watch: (satisfied) => api.condition(satisfied),
    executeSpec: (call, longestMs) =>
      api
        .proxyActivities({
          activityId: `${call.reference}#${call.run}`,
          summary: `${call.reference} executes the ${call.primitive} spec ${call.name}`,
          startToCloseTimeout: longestMs + nestedExecutionMarginMs,
          heartbeatTimeout: nestedHeartbeatTimeout,
          retry: retryTransientFailures,
        })
        .executeSpec(call),
    settle: (request) =>
      api.CancellationScope.nonCancellable(() => api.proxyLocalActivities(settleSettings).settleExecution(request)),
    cancellable: (work) => {
      const scope = new api.CancellationScope();
      return {
        result: scope.run(work),
        cancel: () => {
          scope.cancel();
        },
      };
    },
    isCancellation: (error) => api.isCancellation(error),
  };
}
