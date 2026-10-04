import type { Variables } from '@beonauto/workflow-engine/dsl/expressions';
import { field, objectField, textField, type Json, type JsonObject } from '@beonauto/workflow-engine/dsl/json';
import { taskEntries, typeOf, type TaskEntry } from '@beonauto/workflow-engine/dsl/tasks';

import { holds, placeIn, transform } from './evaluation.ts';
import type { ListResult, Place, Runner, Scope, TaskOutcome } from './invocation.ts';
import { raised } from './raised-error.ts';
import { admitted, dateTimeOf, runtimeDescriptor, type RunState } from './run-state.ts';
import { bodyFor } from './task-bodies.ts';
import { timeoutOf, withTimeout } from './timeouts.ts';

interface TaskStart {
  readonly entry: TaskEntry;
  readonly rawInput: Json;
  readonly descriptor: JsonObject;
  readonly variables: Variables;
  readonly scope: Scope;
  readonly run: number;
}

interface Exported {
  readonly task: JsonObject;
  readonly output: Json;
  readonly variables: Variables;
  readonly place: Place;
}

export const runner: Runner = { runList, runTask };

export function runList(list: Json | undefined, pointer: string, input: Json, scope: Scope): Promise<ListResult> {
  return runFrom(taskEntries(list, pointer), 0, input, scope);
}

function runTask(entry: TaskEntry, rawInput: Json, scope: Scope): Promise<TaskOutcome> {
  const { state } = scope;
  return state.meter.shouldYield()
    ? yieldToOthers(state, entry.reference).then(() => startTask(entry, rawInput, scope))
    : startTask(entry, rawInput, scope);
}

function startTask(entry: TaskEntry, rawInput: Json, scope: Scope): Promise<TaskOutcome> {
  const { state } = scope;
  state.meter.countTask();
  const run = state.nextRun(entry.reference);
  state.step(entry.reference);
  const now = state.host.now();
  const descriptor = {
    name: entry.name,
    reference: entry.reference,
    definition: entry.task,
    input: rawInput,
    startedAt: dateTimeOf(now),
  };
  const variables = {
    ...scope.variables,
    context: state.context(),
    workflow: state.workflow,
    runtime: runtimeDescriptor,
    task: descriptor,
  };
  if (!holds(field(entry.task, 'if'), rawInput, variables, placeIn(state, entry.reference))) {
    return Promise.resolve({ output: rawInput, flow: 'continue' });
  }
  const milliseconds = timeoutOf(state, {
    declared: field(entry.task, 'timeout'),
    data: rawInput,
    variables,
    reference: entry.reference,
  });
  return withTimeout(state, { milliseconds, reference: entry.reference }, () =>
    performTask({ entry, rawInput, descriptor, variables, scope, run }),
  );
}

async function runFrom(entries: readonly TaskEntry[], position: number, data: Json, scope: Scope): Promise<ListResult> {
  const entry = entries[position];
  if (entry === undefined) {
    return { output: data, ending: 'completed' };
  }
  const { output, flow } = await runTask(entry, data, scope);
  if (flow === 'end' || flow === 'exit') {
    return { output, ending: flow === 'end' ? 'ended' : 'exited' };
  }
  return runFrom(entries, flow === 'continue' ? position + 1 : positionOf(entries, flow, entry), output, scope);
}

function positionOf(entries: readonly TaskEntry[], name: string, from: TaskEntry): number {
  const position = entries.findIndex((candidate) => candidate.name === name);
  if (position === -1) {
    throw raised('configuration', 400, `then: ${name} names no task in the same list`, from.reference);
  }
  return position;
}

async function performTask(start: TaskStart): Promise<TaskOutcome> {
  const { entry, rawInput, descriptor, variables, scope, run } = start;
  const { task, reference } = entry;
  const { state } = scope;
  const input = transform(
    field(objectField(task, 'input') ?? {}, 'from'),
    rawInput,
    variables,
    placeIn(state, reference),
  );
  const type = typeOf(task);
  if (type === undefined) {
    throw raised('configuration', 400, 'The task has no type this runtime knows', reference);
  }
  const release = state.hold([rawInput, input], reference);
  try {
    const inputVariables = { ...variables, input };
    const body = await bodyFor(type.kind)({
      entry,
      configuration: type.configuration,
      input,
      variables: inputVariables,
      scope,
      run,
      runner,
    });
    const outputVariables = { ...inputVariables, task: { ...descriptor, output: admitted(body.output, reference) } };
    const place = placeIn(state, reference);
    const output = transform(field(objectField(task, 'output') ?? {}, 'as'), body.output, outputVariables, place);
    exportToContext(state, { task, output: admitted(output, reference), variables: outputVariables, place });
    return { output, flow: body.flow ?? textField(task, 'then') ?? 'continue' };
  } finally {
    release();
  }
}

function exportToContext(state: RunState, { task, output, variables, place }: Exported): void {
  const exported = field(objectField(task, 'export') ?? {}, 'as');
  if (exported !== undefined) {
    const context = transform(exported, output, { ...variables, output, context: state.context() }, place);
    state.replaceContext(admitted(context, place.reference));
  }
}

function yieldToOthers(state: RunState, reference: string): Promise<void> {
  state.checkHistory(reference);
  return state.host.sleep(1, `${reference} lets other workflows run`);
}
