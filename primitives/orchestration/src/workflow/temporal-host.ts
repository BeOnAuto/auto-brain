import type { WorkflowHost } from '../interpreter/host.ts';
import { mostSettleAttempts, type OrchestrationActivities } from './activity-contract.ts';

export interface ActivitySettings {
  readonly activityId: string;
  readonly summary: string;
  readonly startToCloseTimeout: string;
  readonly retry: {
    readonly initialInterval: string;
    readonly backoffCoefficient: number;
    readonly maximumInterval: string;
    readonly maximumAttempts: number;
  };
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
  sleep(milliseconds: number, options: { readonly summary: string }): Promise<void>;
  condition(satisfied: () => boolean): Promise<void>;
  proxyActivities(options: ActivitySettings): OrchestrationActivities;
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

export const settleSettings: ActivitySettings = {
  activityId: 'settle',
  summary: 'settle the execution',
  startToCloseTimeout: '1 minute',
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
    executeSpec: (call) =>
      api
        .proxyActivities({
          activityId: `${call.reference}#${call.run}`,
          summary: `${call.reference} executes the ${call.primitive} spec ${call.name}`,
          startToCloseTimeout: '10 minutes',
          retry: retryTransientFailures,
        })
        .executeSpec(call),
    settle: (request) =>
      api.CancellationScope.nonCancellable(() => api.proxyActivities(settleSettings).settleExecution(request)),
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
