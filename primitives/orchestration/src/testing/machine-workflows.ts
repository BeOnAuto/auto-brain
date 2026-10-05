import { ReceivedEventSchema } from '@beonauto/workflow-engine';
import { memoryDriver, type MemoryDriver } from '@beonauto/workflow-engine/testing';
import { Option, Schema } from 'effect';

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
