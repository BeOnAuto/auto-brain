import type { SettleRequest, SpecCall, SpecCallResult } from '../interpreter/host.ts';
import type { OrchestrationActivities } from '../workflow/activity-contract.ts';
import type {
  ActivitySettings,
  EventSignal,
  TemporalScope,
  TemporalScopes,
  WorkflowApi,
} from '../workflow/temporal-host.ts';
import { FakeCancellation } from './fake-cancellation.ts';

type ApiCall =
  | { readonly name: 'sleep'; readonly milliseconds: number; readonly summary: string }
  | { readonly name: 'condition' }
  | { readonly name: 'proxyActivities'; readonly settings: ActivitySettings }
  | { readonly name: 'executeSpec'; readonly call: SpecCall }
  | { readonly name: 'settleExecution'; readonly request: SettleRequest }
  | { readonly name: 'scope'; readonly event: 'run' | 'cancel' | 'non-cancellable' }
  | { readonly name: 'defineSignal'; readonly signal: string }
  | { readonly name: 'setHandler'; readonly signal: string };

export interface FakeWorkflowApi {
  readonly api: WorkflowApi;
  readonly calls: () => readonly ApiCall[];
  readonly signal: (event: unknown) => void;
}

export interface FakeWorkflowApiOptions {
  readonly sleep?: (summary: string) => Promise<void>;
  readonly answer?: SpecCallResult;
}

type Record = (call: ApiCall) => void;

function sleepUntilDeadline(summary: string): Promise<void> {
  return summary === 'the most the workflow may run' ? Promise.withResolvers<void>().promise : Promise.resolve();
}

export function fakeWorkflowApi(options: FakeWorkflowApiOptions = {}): FakeWorkflowApi {
  const calls: ApiCall[] = [];
  const handlers: ((event: unknown) => void)[] = [];
  const record: Record = (call) => {
    calls.push(call);
  };
  const api: WorkflowApi = {
    CancellationScope: recordingScopes(record),
    ApplicationFailure: { create: ({ type, message }) => new Error(`${type}: ${message}`) },
    sleep: (milliseconds, { summary }) => {
      record({ name: 'sleep', milliseconds, summary });
      return (options.sleep ?? sleepUntilDeadline)(summary);
    },
    condition: () => {
      record({ name: 'condition' });
      return Promise.resolve();
    },
    proxyActivities: (settings) => {
      record({ name: 'proxyActivities', settings });
      return recordingActivities(record, options.answer ?? { status: 'succeeded', output: { answered: true } });
    },
    isCancellation: (error) => error instanceof FakeCancellation,
    workflowInfo: () => ({ historySize: 1024, historyLength: 12 }),
    defineSignal: (signal) => {
      record({ name: 'defineSignal', signal });
      return { type: 'signal', name: signal };
    },
    setHandler: (signal: EventSignal, handler) => {
      record({ name: 'setHandler', signal: signal.name });
      handlers.push(handler);
    },
  };
  return {
    api,
    calls: () => calls,
    signal: (event) => {
      for (const handler of handlers) {
        handler(event);
      }
    },
  };
}

function recordingActivities(record: Record, answer: SpecCallResult): OrchestrationActivities {
  return {
    executeSpec: (call) => {
      record({ name: 'executeSpec', call });
      return Promise.resolve(answer);
    },
    settleExecution: (request) => {
      record({ name: 'settleExecution', request });
      return Promise.resolve();
    },
  };
}

function recordingScopes(record: Record): TemporalScopes {
  return class implements TemporalScope {
    static nonCancellable<T>(work: () => Promise<T>): Promise<T> {
      record({ name: 'scope', event: 'non-cancellable' });
      return work();
    }

    run<T>(work: () => Promise<T>): Promise<T> {
      record({ name: 'scope', event: 'run' });
      return work();
    }

    cancel(): void {
      record({ name: 'scope', event: 'cancel' });
    }
  };
}
