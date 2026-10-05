import { Effect } from 'effect';

import { workflowEngineOf } from '../engine/engine.ts';
import type { Submission, WorkflowEngine } from '../engine/workflow-engine.ts';
import type { EventReceived, RunInput } from '../machine/run-input.ts';
import type { MachineOptions } from '../runner/run-descriptors.ts';
import { startedOf, testMachine, type StartRequest } from './driver-inputs.ts';
import type { Responder } from './memory-executor.ts';
import { memoryPorts, type MemoryPorts } from './memory-ports.ts';
import { runWatchOf, type RunWatch } from './run-watch.ts';
import { virtualClock, type VirtualClock } from './virtual-clock.ts';

export interface DriverOptions {
  readonly machine?: MachineOptions;
  readonly respond?: Responder;
  readonly startedAt?: number;
}

export interface MemoryDriver extends RunWatch {
  readonly ports: MemoryPorts;
  readonly engine: WorkflowEngine;
  readonly clock: VirtualClock;
  readonly start: (request: StartRequest) => Submission;
  readonly submit: (input: RunInput) => Submission;
  readonly deliver: (executionId: string, event: EventReceived['event']) => Submission;
  readonly cancel: (executionId: string) => Submission;
  readonly at: (milliseconds: number, action: () => void) => void;
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
  const engine = workflowEngineOf(ports, options.machine ?? testMachine);
  function submit(input: RunInput): Submission {
    return Effect.runSync(engine.submit(input));
  }
  return {
    ...runWatchOf(ports.runStore, clock),
    ports,
    engine,
    clock,
    start: (request) => {
      ports.recordStore.known(request.executionId);
      return submit(startedOf(request, clock.now()));
    },
    submit,
    deliver: (executionId, event) => submit({ kind: 'event_received', executionId, at: clock.now(), event }),
    cancel: (executionId) => submit({ kind: 'cancel_requested', executionId, at: clock.now() }),
    at: (milliseconds, action) => {
      const due = clock.now() + milliseconds;
      clock.schedule(due, `scheduled ${due} ${clock.pending()}`, action);
    },
  };
}
