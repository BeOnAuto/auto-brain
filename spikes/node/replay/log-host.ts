import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';

import type { JsonObject } from '../../../primitives/orchestration/src/dsl/json.ts';
import type {
  SettleRequest,
  SpecCall,
  SpecCallResult,
  WorkflowHost,
} from '../../../primitives/orchestration/src/interpreter/host.ts';
import type { WorkflowStart } from '../../../primitives/orchestration/src/interpreter/interpreter.ts';
import { FakeCancellation } from '../../../primitives/orchestration/src/testing/fake-cancellation.ts';
import { FakeScope } from '../../../primitives/orchestration/src/testing/fake-scope.ts';
import { workflowStartedAt } from '../../../primitives/orchestration/src/testing/virtual-clock.ts';
import { LeanScope } from './lean-scope.ts';

export type Input =
  | { readonly k: 'timer'; readonly seq: number; readonly at: number }
  | { readonly k: 'result'; readonly seq: number; readonly at: number; readonly result: SpecCallResult }
  | { readonly k: 'event'; readonly at: number; readonly event: JsonObject };

export type Waiting =
  | {
      readonly kind: 'timer';
      readonly seq: number;
      readonly dueAt: number;
      readonly summary: string;
      readonly resolve: () => void;
    }
  | {
      readonly kind: 'call';
      readonly seq: number;
      readonly issuedAt: number;
      readonly call: SpecCall;
      readonly resolve: (result: SpecCallResult) => void;
    }
  | {
      readonly kind: 'condition';
      readonly seq: number;
      readonly since: number;
      readonly listens: boolean;
      readonly satisfied: () => boolean;
      readonly resolve: () => void;
    };

export interface LogEngine {
  readonly host: WorkflowHost;
  readonly waiting: () => readonly Waiting[];
  readonly now: () => number;
  readonly start: (begin: (host: WorkflowHost) => WorkflowStart) => Promise<WorkflowStart>;
  readonly apply: (input: Input) => Promise<void>;
  readonly commands: () => number;
  readonly activations: () => number;
  readonly digest: () => string;
  readonly settled: () => SettleRequest | undefined;
}

const historyEventsWrapAt = 30_000;

export type ScopeKind = 'fake' | 'lean';

export function logEngine(scopes: ScopeKind = 'lean'): LogEngine {
  const storage = new AsyncLocalStorage<FakeScope | LeanScope>();
  const root = scopes === 'fake' ? new FakeScope() : new LeanScope();
  const scope = (): FakeScope | LeanScope => storage.getStore() ?? root;
  const waiting = new Map<number, Waiting>();
  const hash = createHash('sha1');
  let clock = workflowStartedAt;
  let activation = 0;
  let seq = 0;
  let commands = 0;
  let settled: SettleRequest | undefined;
  let deliver: (event: unknown) => void = () => {};

  const command = (text: string): number => {
    seq += 1;
    commands += 1;
    hash.update(`${seq}|${text}\n`);
    return seq;
  };
  const forgetting = (id: number, summary: string) => () => {
    waiting.delete(id);
    command(`cancel ${id} ${summary}`);
  };
  const timer = (milliseconds: number, summary: string): Promise<void> => {
    const id = command(`timer ${milliseconds} ${summary}`);
    return scope().operation<void>((resolve) => {
      waiting.set(id, { kind: 'timer', seq: id, dueAt: clock + Math.max(milliseconds, 1), summary, resolve });
      return forgetting(id, summary);
    });
  };
  const condition = (satisfied: () => boolean, listens: boolean): Promise<void> => {
    const id = command(listens ? 'condition' : 'watch');
    return scope().operation<void>((resolve) => {
      waiting.set(id, { kind: 'condition', seq: id, since: clock, listens, satisfied, resolve });
      return forgetting(id, 'condition');
    });
  };

  const host: WorkflowHost = {
    now: () => clock,
    random: () => 0.5,
    historySize: () => ({ bytes: 0, events: activation % historyEventsWrapAt }),
    sleep: (milliseconds, summary) => timer(milliseconds, summary),
    deadline: (milliseconds) => timer(milliseconds, 'deadline'),
    waitUntil: (satisfied) => condition(satisfied, true),
    watch: (satisfied) => condition(satisfied, false),
    executeSpec: (call) => {
      const id = command(
        `call ${call.reference}#${call.run} ${call.primitive}/${call.name} ${JSON.stringify(call.input)}`,
      );
      return scope().operation<SpecCallResult>((resolve) => {
        waiting.set(id, { kind: 'call', seq: id, issuedAt: clock, call, resolve });
        return forgetting(id, call.reference);
      });
    },
    settle: (request) => {
      command(`settle ${request.settlement.status}`);
      settled = request;
      return Promise.resolve();
    },
    cancellable: (work) => {
      const parent = scope();
      if (parent instanceof LeanScope) {
        const { scope: child, forget } = parent.child();
        const result = storage.run(child, work);
        void result.then(forget, forget);
        return {
          result,
          cancel: () => {
            child.cancel();
          },
        };
      }
      const child = parent.child();
      return {
        result: storage.run(child, work),
        cancel: () => {
          child.cancel();
        },
      };
    },
    isCancellation: (error) => error instanceof FakeCancellation,
  };

  const resolveSatisfied = (): boolean => {
    const satisfied = [...waiting.values()].filter((entry) => entry.kind === 'condition' && entry.satisfied());
    for (const entry of satisfied) {
      waiting.delete(entry.seq);
      if (entry.kind === 'condition') {
        entry.resolve();
      }
    }
    return satisfied.length > 0;
  };
  const quiesce = async (): Promise<void> => {
    await setImmediate();
    while (resolveSatisfied()) {
      await setImmediate();
    }
  };

  return {
    host,
    waiting: () => [...waiting.values()],
    now: () => clock,
    start: async (begin) => {
      const started = storage.run(root, () => begin(host));
      deliver = started.deliver;
      await quiesce();
      return started;
    },
    apply: async (input) => {
      if (input.at < clock) {
        throw new Error(`Divergence: input at ${input.at} is before the clock ${clock}`);
      }
      clock = input.at;
      activation += 1;
      if (input.k === 'event') {
        deliver(input.event);
      } else {
        const entry = waiting.get(input.seq);
        waiting.delete(input.seq);
        if (input.k === 'timer' && entry?.kind === 'timer') {
          entry.resolve();
        } else if (input.k === 'result' && entry?.kind === 'call') {
          entry.resolve(input.result);
        } else {
          throw new Error(
            `Divergence: a ${input.k} for command ${input.seq}, which waits for ${entry?.kind ?? 'nothing'}`,
          );
        }
      }
      await quiesce();
    },
    commands: () => commands,
    activations: () => activation,
    digest: () => hash.copy().digest('hex'),
    settled: () => settled,
  };
}
