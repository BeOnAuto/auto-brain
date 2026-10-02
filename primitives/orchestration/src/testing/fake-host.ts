import { AsyncLocalStorage } from 'node:async_hooks';
import { setImmediate } from 'node:timers/promises';

import type { HistorySize, SettleRequest, SpecCall, SpecCallResult, WorkflowHost } from '../interpreter/host.ts';
import { FakeCancellation } from './fake-cancellation.ts';
import { FakeScope } from './fake-scope.ts';
import { virtualClock, type VirtualClock } from './virtual-clock.ts';

export type Command =
  | { readonly kind: 'timer'; readonly milliseconds: number; readonly summary: string }
  | { readonly kind: 'deadline'; readonly milliseconds: number }
  | { readonly kind: 'call'; readonly call: SpecCall }
  | { readonly kind: 'condition' }
  | { readonly kind: 'cancelled'; readonly summary: string }
  | { readonly kind: 'settle'; readonly request: SettleRequest };

type SpecResponder = (call: SpecCall) => SpecCallResult | Promise<SpecCallResult>;

export interface FakeHostOptions {
  readonly random?: number;
  readonly respond?: SpecResponder;
  readonly history?: HistorySize;
}

export interface FakeHost {
  readonly host: WorkflowHost;
  readonly commands: () => readonly Command[];
  readonly now: () => number;
  readonly drive: <T>(start: () => Promise<T>) => Promise<T>;
  readonly cancelWorkflow: () => void;
  readonly at: (milliseconds: number, action: () => void) => void;
}

type Progress<T> =
  | { readonly state: 'running' }
  | { readonly state: 'fulfilled'; readonly value: T }
  | { readonly state: 'rejected'; readonly error: unknown };

interface Journal {
  readonly record: (command: Command) => void;
  readonly entries: () => readonly Command[];
}

interface Scopes {
  readonly current: () => FakeScope;
  readonly run: <T>(scope: FakeScope, work: () => Promise<T>) => Promise<T>;
}

interface Activations {
  readonly next: () => void;
  readonly count: () => number;
}

interface Parts {
  readonly clock: VirtualClock;
  readonly scopes: Scopes;
  readonly root: FakeScope;
  readonly journal: Journal;
  readonly respond: SpecResponder;
  readonly activations: Activations;
}

const succeedWithNull: SpecResponder = () => ({ status: 'succeeded', output: null });

export function fakeHost(options: FakeHostOptions = {}): FakeHost {
  const storage = new AsyncLocalStorage<FakeScope>();
  const root = new FakeScope();
  const log: Command[] = [];
  const parts: Parts = {
    clock: virtualClock(),
    scopes: { current: () => storage.getStore() ?? root, run: (scope, work) => storage.run(scope, work) },
    root,
    journal: {
      record: (command) => {
        log.push(command);
      },
      entries: () => log,
    },
    respond: options.respond ?? succeedWithNull,
    activations: countingActivations(),
  };
  const history: HistorySize = options.history ?? { bytes: 0, events: 0 };
  const host: WorkflowHost = {
    ...operationsOf(parts),
    random: () => options.random ?? 0.5,
    historySize: () => ({ bytes: history.bytes, events: history.events + parts.activations.count() }),
  };
  return {
    host,
    commands: parts.journal.entries,
    now: parts.clock.now,
    drive: (start) => drive(parts, start),
    cancelWorkflow: () => {
      parts.root.cancel();
    },
    at: (milliseconds, action) => {
      parts.clock.timer(milliseconds, action);
    },
  };
}

function operationsOf(parts: Parts): Omit<WorkflowHost, 'random' | 'historySize'> {
  const { clock, scopes, journal, respond } = parts;
  const scope = scopes.current;
  return {
    now: clock.now,
    sleep: (milliseconds, summary) => {
      journal.record({ kind: 'timer', milliseconds, summary });
      return scope().operation<void>((resolve) => cancelling(clock.timer(milliseconds, resolve), journal, summary));
    },
    deadline: (milliseconds) => {
      journal.record({ kind: 'deadline', milliseconds });
      return scope().operation<void>((resolve) => clock.timer(milliseconds, resolve));
    },
    waitUntil: (satisfied) => {
      journal.record({ kind: 'condition' });
      return scope().operation<void>((resolve) => cancelling(clock.waiter(satisfied, resolve), journal, 'condition'));
    },
    executeSpec: (call) => {
      journal.record({ kind: 'call', call });
      return scope().operation<SpecCallResult>((resolve, reject) => {
        void Promise.resolve(call).then(respond).then(resolve, reject);
        return cancelling(() => call, journal, call.reference);
      });
    },
    settle: (request) => {
      journal.record({ kind: 'settle', request });
      return Promise.resolve();
    },
    cancellable: (work) => {
      const child = scope().child();
      return {
        result: scopes.run(child, work),
        cancel: () => {
          child.cancel();
        },
      };
    },
    isCancellation: (error) => error instanceof FakeCancellation,
  };
}

function cancelling(forget: () => unknown, journal: Journal, summary: string): () => void {
  return () => {
    forget();
    journal.record({ kind: 'cancelled', summary });
  };
}

function countingActivations(): Activations {
  let count = 0;
  return {
    next: () => {
      count += 1;
    },
    count: () => count,
  };
}

function drive<T>({ clock, scopes, root, activations }: Parts, start: () => Promise<T>): Promise<T> {
  let progress: Progress<T> = { state: 'running' };
  void scopes.run(root, start).then(
    (value) => {
      progress = { state: 'fulfilled', value };
      return value;
    },
    (error: unknown) => {
      progress = { state: 'rejected', error };
      return error;
    },
  );
  return untilDone({ clock, activations }, () => progress);
}

async function untilDone<T>(driver: Pick<Parts, 'clock' | 'activations'>, progress: () => Progress<T>): Promise<T> {
  await setImmediate();
  const current = progress();
  if (current.state === 'fulfilled') {
    return current.value;
  }
  if (current.state === 'rejected') {
    throw current.error;
  }
  driver.activations.next();
  if (!driver.clock.advance()) {
    throw new Error('The workflow waits for something that never comes');
  }
  return untilDone(driver, progress);
}
