import {
  ReceivedEventSchema,
  newRun,
  workflowMachine,
  type ArmedTimer,
  type RunInput,
  type RunOutput,
  type RunState,
} from '@beonauto/workflow-engine';
import { memoryDriver, type MemoryDriver } from '@beonauto/workflow-engine/testing';
import { Option, Result, Schema } from 'effect';

import { orchestrationMachine } from '../runs/orchestration-machine.ts';
import { endingOf, type WorkflowEnding } from './endings.ts';
import { answerOf, commandsOf, type SpecResponder } from './machine-commands.ts';
import type { Command, MachineHost, WorkflowStart } from './machine-host.ts';
import type { RunSettlement, WorkflowRun } from './run-terms.ts';

export interface MachineOptions {
  readonly respond?: SpecResponder;
  readonly started?: (start: WorkflowStart, host: MachineHost) => void;
}

export interface MachineInterpretation {
  readonly ending: WorkflowEnding;
  readonly settlement: RunSettlement | undefined;
  readonly commands: readonly Command[];
  readonly fake: MachineHost;
}

const succeedWithNull: SpecResponder = () => ({ status: 'succeeded', output: null });

const receivedEventOf = Schema.decodeUnknownOption(ReceivedEventSchema);

function drivenRun(run: WorkflowRun, respond: SpecResponder): MemoryDriver {
  return memoryDriver({
    machine: orchestrationMachine,
    respond: (call) => ({ later: answerOf(run, respond, call.key, call.arguments) }),
  });
}

function hooksOf(
  driver: MemoryDriver,
  run: WorkflowRun,
): { readonly start: WorkflowStart; readonly host: MachineHost } {
  const executionId = run.execution.id;
  const host: MachineHost = {
    commands: () => commandsOf(run, driver.ports.faults.dispatched()),
    now: driver.clock.now,
    cancelWorkflow: () => {
      driver.cancel(executionId);
    },
    at: (milliseconds, action) => {
      driver.at(milliseconds, action);
    },
  };
  const start: WorkflowStart = {
    deliver: (event) => {
      Option.map(receivedEventOf(event), (received) => driver.deliver(executionId, received));
    },
  };
  return { start, host };
}

export async function interpretOnMachine(run: WorkflowRun, options: MachineOptions): Promise<MachineInterpretation> {
  const executionId = run.execution.id;
  const driver = drivenRun(run, options.respond ?? succeedWithNull);
  driver.start({
    executionId,
    document: run.document,
    input: run.input,
    limits: { mostDurationMs: run.mostDuration, longestCallMs: run.longestNestedExecutionMs },
    attributes: { org: run.execution.org, brain: run.execution.brain },
  });
  const { start, host } = hooksOf(driver, run);
  options.started?.(start, host);
  const outcome = await driver.outcomeOf(executionId);
  return {
    ending: endingOf(outcome),
    settlement: driver.ports.recordStore.settlementOf(executionId),
    commands: host.commands(),
    fake: host,
  };
}

const machine = workflowMachine(orchestrationMachine);

interface Decided {
  readonly state: RunState;
  readonly outputs: readonly RunOutput[];
}

function decidedOn({ state, outputs }: Decided, input: RunInput): Decided {
  const events = Result.getOrThrow(machine.decide(input, state));
  return {
    state: events.reduce((folded, event) => machine.evolve(folded, event), state),
    outputs: [...outputs, ...events.flatMap((event) => event.outputs)],
  };
}

function firedWhileDue(decided: Decided, executionId: string): Decided {
  const due = Object.entries(decided.state.timers.armed).find(
    ([, timer]: readonly [string, ArmedTimer]) => timer.dueAt <= 0,
  );
  return due === undefined
    ? decided
    : firedWhileDue(decidedOn(decided, { kind: 'timer_fired', executionId, at: 0, timerId: due[0] }), executionId);
}

export function outputsAtOnce(run: WorkflowRun): readonly RunOutput[] {
  const executionId = run.execution.id;
  const started = decidedOn(
    { state: newRun, outputs: [] },
    {
      kind: 'started',
      executionId,
      at: 0,
      document: run.document,
      input: run.input,
      limits: { mostDurationMs: run.mostDuration, longestCallMs: run.longestNestedExecutionMs },
      attributes: { org: run.execution.org, brain: run.execution.brain },
      seed: 1,
    },
  );
  return firedWhileDue(started, executionId).outputs;
}
