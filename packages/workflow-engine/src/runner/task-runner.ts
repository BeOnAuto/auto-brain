import { admitted, holds, transform } from '../dsl/evaluation.ts';
import type { Variables } from '../dsl/expressions.ts';
import { field, objectField, textField, type Json } from '../dsl/json.ts';
import { RaisedError, raised } from '../dsl/raised-error.ts';
import { timedOut, timeoutMilliseconds } from '../dsl/task-outcomes.ts';
import { entryAt, typeOf, type TaskEntry } from '../dsl/tasks.ts';
import type { TaskFrame, ValueId, Variables as Scope } from '../machine/run-state.ts';
import { cancelBody, resumeBody, startBody } from '../tasks/task-bodies.ts';
import {
  raisedOf,
  type BodyAdvance,
  type FramePrefix,
  type Invocation,
  type Machine,
  type Signal,
  type TaskAdvance,
} from './advance.ts';
import { descriptorOf, taskVariablesOf, withInput } from './task-variables.ts';

function caught(machine: Machine, frame: FramePrefix, attempt: () => TaskAdvance): TaskAdvance {
  try {
    return attempt();
  } catch (error) {
    if (!(error instanceof RaisedError)) {
      throw error;
    }
    machine.session.timers.disarm(frame.timeout ?? machine.session.timers.timerOf('timeout', frame.reference));
    machine.session.record(frame.reference, frame.run, 'raised');
    return raisedOf(error.error);
  }
}

function invocationOf(machine: Machine, frame: FramePrefix, entry: TaskEntry): Invocation {
  const { session } = machine;
  const type = typeOf(entry.task);
  if (type === undefined) {
    throw raised('configuration', 400, 'The task has no type this runtime knows', entry.reference);
  }
  const input = session.valueOf(frame.input);
  return {
    machine,
    frame,
    entry,
    kind: type.kind,
    configuration: type.configuration,
    input,
    variables: withInput(taskVariablesOf(session, frame, entry), input),
  };
}

function exported(invocation: Invocation, output: Json, variables: Variables): void {
  const { machine, entry } = invocation;
  const { session } = machine;
  const exportAs = field(objectField(entry.task, 'export') ?? {}, 'as');
  if (exportAs !== undefined) {
    const context = transform(
      exportAs,
      output,
      { ...variables, output, context: session.valueOf(session.context()) },
      session.placeAt(entry.reference),
    );
    session.replaceContext(session.hold(admitted(context, entry.reference)));
  }
}

function finished(invocation: Invocation, output: ValueId, flow: string | null): TaskAdvance {
  const { machine, entry, frame } = invocation;
  const { session } = machine;
  const value = admitted(session.valueOf(output), entry.reference);
  const variables = { ...invocation.variables, task: { ...descriptorOf(session, frame, entry), output: value } };
  const shaped = admitted(
    transform(field(objectField(entry.task, 'output') ?? {}, 'as'), value, variables, session.placeAt(entry.reference)),
    entry.reference,
  );
  exported(invocation, shaped, variables);
  session.timers.disarm(frame.timeout);
  session.record(entry.reference, frame.run, 'completed');
  return {
    kind: 'done',
    output: shaped === value ? output : session.hold(shaped),
    flow: flow ?? textField(entry.task, 'then') ?? 'continue',
  };
}

function settled(invocation: Invocation, advance: BodyAdvance): TaskAdvance {
  const { machine, frame } = invocation;
  if (advance.kind === 'waiting') {
    return { kind: 'waiting', frame: { ...frame, body: advance.body } };
  }
  if (advance.kind === 'raised') {
    machine.session.timers.disarm(frame.timeout);
    machine.session.record(frame.reference, frame.run, 'raised');
    return advance;
  }
  return finished(invocation, advance.output, advance.flow);
}

function performed(machine: Machine, entry: TaskEntry, frame: FramePrefix): TaskAdvance {
  const { session } = machine;
  const variables = taskVariablesOf(session, frame, entry);
  const place = session.placeAt(entry.reference);
  const rawValue = session.valueOf(frame.rawInput);
  if (!holds(field(entry.task, 'if'), rawValue, variables, place)) {
    session.record(entry.reference, frame.run, 'skipped');
    return { kind: 'done', output: frame.rawInput, flow: 'continue' };
  }
  const milliseconds = timeoutMilliseconds(field(entry.task, 'timeout'), session.components().timeouts, {
    data: rawValue,
    variables,
    place,
  });
  const timeout =
    milliseconds === undefined
      ? null
      : session.timers.arm({
          purpose: 'timeout',
          reference: entry.reference,
          milliseconds,
          label: `${entry.reference} timeout`,
        });
  const inputValue = transform(field(objectField(entry.task, 'input') ?? {}, 'from'), rawValue, variables, place);
  const input = inputValue === rawValue ? frame.rawInput : session.hold(inputValue);
  const invocation = invocationOf(machine, { ...frame, timeout, input }, entry);
  return settled(invocation, startBody(invocation.kind, invocation));
}

export function startTask(machine: Machine, entry: TaskEntry, rawInput: ValueId, scope: Scope): TaskAdvance {
  const { session } = machine;
  session.meter.countTask();
  const run = session.nextRun(entry.reference);
  const frame: FramePrefix = {
    reference: entry.reference,
    run,
    startedAt: session.now,
    context: session.context(),
    rawInput,
    input: rawInput,
    variables: scope,
    timeout: null,
  };
  session.record(entry.reference, run, 'started');
  return caught(machine, frame, () => {
    session.step(entry.reference);
    return performed(machine, entry, frame);
  });
}

export function resumeTask(machine: Machine, frame: TaskFrame, signal: Signal): TaskAdvance | undefined {
  const { session } = machine;
  if (signal.kind === 'timer' && signal.timerId === frame.timeout) {
    cancelBody(machine, frame.body);
    session.record(frame.reference, frame.run, 'timed_out');
    return raisedOf(timedOut(signal.timer.dueAt - signal.timer.armedAt, frame.reference).error);
  }
  const entry = entryAt(session.document(), frame.reference);
  const resumed = caught(machine, frame, () => {
    const invocation = invocationOf(machine, frame, entry);
    const advance = resumeBody(invocation, frame.body, signal);
    return advance === undefined ? { kind: 'waiting', frame } : settled(invocation, advance);
  });
  return resumed.kind === 'waiting' && resumed.frame === frame ? undefined : resumed;
}

export function cancelTask(machine: Machine, frame: TaskFrame): void {
  machine.session.timers.disarm(frame.timeout);
  cancelBody(machine, frame.body);
  machine.session.record(frame.reference, frame.run, 'cancelled');
}
