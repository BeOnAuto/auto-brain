import { Effect } from 'effect';

import type { Submission, WorkflowEngine } from '../engine/workflow-engine.ts';
import type { CancelOrder, EventOffered, EventReceived, RunInput } from '../machine/run-input.ts';
import type { Responder } from '../memory/memory-executor.ts';
import { memoryPorts, type MemoryPorts } from '../memory/memory-ports.ts';
import { virtualClock, type VirtualClock } from '../memory/virtual-clock.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { startedOf, testCancel, testMachine, type StartRequest } from './driver-inputs.ts';
import { engineOfFrozenRuns } from './frozen-runs.ts';
import { runWatchOf, type RunWatch } from './run-watch.ts';

export interface DriverOptions {
  readonly machine?: MachineOptions;
  readonly respond?: Responder;
  readonly startedAt?: number;
  readonly mostSteps?: number;
}

export interface MemoryDriver extends RunWatch {
  readonly ports: MemoryPorts;
  readonly engine: WorkflowEngine;
  readonly clock: VirtualClock;
  readonly start: (request: StartRequest) => Submission;
  readonly submit: (input: RunInput) => Submission;
  readonly deliver: (executionId: string, event: EventReceived['event']) => Submission;
  readonly offer: (offer: Omit<EventOffered, 'kind' | 'at'>) => Submission;
  readonly cancel: (executionId: string, order?: CancelOrder) => Submission;
  readonly at: (milliseconds: number, action: () => void) => void;
  readonly inputsOf: (executionId: string) => readonly RunInput[];
}

const succeedWithNull: Responder = () => ({ result: { status: 'succeeded', output: null } });

export function memoryDriver(options: DriverOptions = {}): MemoryDriver {
  const clock = virtualClock(options.startedAt);
  const ports = memoryPorts(
    clock,
    (input) => {
      submit(input);
    },
    options.respond ?? succeedWithNull,
  );
  const engine = engineOfFrozenRuns(ports, options.machine ?? testMachine);
  const given: RunInput[] = [];
  function submit(input: RunInput): Submission {
    given.push(input);
    return Effect.runSync(engine.submit(input));
  }
  return {
    ...runWatchOf(ports.runStore, clock, options.mostSteps),
    ports,
    engine,
    clock,
    start: (request) => {
      ports.recordStore.known(request.executionId);
      return submit(startedOf(request, clock.now()));
    },
    submit,
    deliver: (executionId, event) => submit({ kind: 'event_received', executionId, at: clock.now(), event }),
    offer: (offer) => submit({ ...offer, kind: 'event_offered', at: clock.now() }),
    cancel: (executionId, order = testCancel) =>
      submit({ kind: 'cancel_requested', executionId, at: clock.now(), cancel: order }),
    at: (milliseconds, action) => {
      const due = clock.now() + milliseconds;
      clock.schedule(due, `scheduled ${due} ${clock.pending()}`, action);
    },
    inputsOf: (executionId) => given.filter((input) => input.executionId === executionId),
  };
}
