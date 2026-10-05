import { ReceivedEventSchema } from '@beonauto/workflow-engine';
import { memoryDriver, type MemoryDriver } from '@beonauto/workflow-engine/testing';
import { Option, Schema } from 'effect';

import { workflowFunctions } from '../document/workflow-functions.ts';
import type { RunSettlement } from '../interpreter/host.ts';
import type { WorkflowStart } from '../interpreter/interpreter.ts';
import { runtimeDescriptor } from '../interpreter/run-state.ts';
import type { WorkflowRun } from '../interpreter/workflow-run.ts';
import { fakeHost, type Command, type FakeHost } from './fake-host.ts';
import { answerOf, commandsOf, endingOfRun, type SpecResponder } from './machine-commands.ts';

export interface MachineOptions {
  readonly respond?: SpecResponder;
  readonly started?: (start: WorkflowStart, fake: FakeHost) => void;
}

export interface MachineInterpretation {
  readonly ending: ReturnType<typeof endingOfRun>;
  readonly settlement: RunSettlement | undefined;
  readonly commands: readonly Command[];
  readonly fake: FakeHost;
}

const succeedWithNull: SpecResponder = () => ({ status: 'succeeded', output: null });

const receivedEventOf = Schema.decodeUnknownOption(ReceivedEventSchema);

function drivenRun(run: WorkflowRun, respond: SpecResponder): MemoryDriver {
  return memoryDriver({
    machine: { functions: workflowFunctions, runtime: runtimeDescriptor },
    respond: (call) => ({ later: answerOf(run, respond, call.key, call.arguments) }),
  });
}

function hooksOf(driver: MemoryDriver, run: WorkflowRun): { readonly start: WorkflowStart; readonly fake: FakeHost } {
  const executionId = run.execution.id;
  const fake: FakeHost = {
    ...fakeHost(),
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
    ending: Promise.resolve({ kind: 'cancelled', cause: undefined }),
  };
  return { start, fake };
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
  const { start, fake } = hooksOf(driver, run);
  options.started?.(start, fake);
  const outcome = await driver.outcomeOf(executionId);
  return {
    ending: endingOfRun(outcome),
    settlement: driver.ports.recordStore.settlementOf(executionId),
    commands: fake.commands(),
    fake,
  };
}
