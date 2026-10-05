import { evaluateExpression, holds } from '../dsl/evaluation.ts';
import { field, isList, itemAt, objectField, textField, type JsonObject } from '../dsl/json.ts';
import { raised } from '../dsl/raised-error.ts';
import type { FrameBody, ValueId } from '../machine/run-state.ts';
import {
  doneOf,
  listBodyOf,
  type BodyAdvance,
  type Invocation,
  type ListAdvance,
  type Machine,
  type Signal,
} from '../runner/advance.ts';
import { scopeValuesOf } from '../runner/task-variables.ts';

type ForBody = Extract<FrameBody, { readonly kind: 'for' }>;

interface Iteration {
  readonly items: ValueId;
  readonly index: number;
  readonly data: ValueId;
}

function loopOf(invocation: Invocation): JsonObject {
  return objectField(invocation.entry.task, 'for') ?? {};
}

function afterBody(invocation: Invocation, iteration: Iteration, advance: ListAdvance): BodyAdvance {
  if (advance.kind === 'waiting') {
    return { kind: 'waiting', body: { kind: 'for', ...iteration, list: advance.cursor } };
  }
  if (advance.kind === 'ended' && advance.ending === 'completed') {
    return iterated(invocation, { ...iteration, index: iteration.index + 1, data: advance.output });
  }
  return listBodyOf(advance);
}

function iterated(invocation: Invocation, iteration: Iteration): BodyAdvance {
  const { machine, entry, frame, variables } = invocation;
  const { session } = machine;
  const item = itemAt(session.valueOf(iteration.items), iteration.index);
  if (item === undefined) {
    return doneOf(iteration.data);
  }
  const loop = loopOf(invocation);
  const scope = {
    ...frame.variables,
    [textField(loop, 'each') ?? 'item']: session.hold(item),
    [textField(loop, 'at') ?? 'index']: session.hold(iteration.index),
  };
  const conditionVariables = {
    ...variables,
    ...scopeValuesOf(session, scope),
    context: session.valueOf(session.context()),
  };
  if (
    !holds(
      field(entry.task, 'while'),
      session.valueOf(iteration.data),
      conditionVariables,
      session.placeAt(entry.reference),
    )
  ) {
    return doneOf(iteration.data);
  }
  const advance = machine.runner.startList(machine, {
    pointer: `${entry.reference}/do`,
    data: iteration.data,
    variables: scope,
  });
  return afterBody(invocation, iteration, advance);
}

export function startFor(invocation: Invocation): BodyAdvance {
  const { machine, entry, input, variables } = invocation;
  const { session } = machine;
  const items = evaluateExpression(
    textField(loopOf(invocation), 'in') ?? 'null',
    input,
    variables,
    session.placeAt(entry.reference),
  );
  if (!isList(items)) {
    throw raised('validation', 400, 'for.in must give an array to iterate over', entry.reference);
  }
  return iterated(invocation, { items: session.hold(items), index: 0, data: invocation.frame.input });
}

export function resumeFor(invocation: Invocation, body: ForBody, signal: Signal): BodyAdvance | undefined {
  const advance = invocation.machine.runner.resumeList(invocation.machine, body.list, signal);
  return advance === undefined
    ? undefined
    : afterBody(invocation, { items: body.items, index: body.index, data: body.data }, advance);
}

export function cancelFor(machine: Machine, body: ForBody): void {
  machine.runner.cancelList(machine, body.list);
}
