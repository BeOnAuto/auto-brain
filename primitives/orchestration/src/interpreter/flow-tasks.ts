import { evaluateExpression, holds } from '@beonauto/workflow-engine/dsl/evaluation';
import type { Variables } from '@beonauto/workflow-engine/dsl/expressions';
import {
  field,
  isList,
  objectField,
  textField,
  type Json,
  type JsonArray,
  type JsonObject,
} from '@beonauto/workflow-engine/dsl/json';
import { raised } from '@beonauto/workflow-engine/dsl/raised-error';
import { chosenFlow } from '@beonauto/workflow-engine/dsl/task-outcomes';
import { taskEntries } from '@beonauto/workflow-engine/dsl/tasks';

import type { Release } from './holding.ts';
import { bodyOf, type Body, type Invocation, type TaskOutcome } from './invocation.ts';
import { placeOf } from './place.ts';

type Settlement =
  | { readonly index: number; readonly outcome: TaskOutcome }
  | { readonly index: number; readonly failure: unknown };

interface Contender {
  readonly index: number;
  readonly settled: Promise<Settlement>;
}

interface Iteration {
  readonly invocation: Invocation;
  readonly loop: JsonObject;
  readonly items: JsonArray;
  readonly index: number;
  readonly data: Json;
}

export async function doTask(invocation: Invocation): Promise<Body> {
  const { entry, input, scope, runner } = invocation;
  return bodyOf(await runner.runList(field(entry.task, 'do'), `${entry.reference}/do`, input, scope));
}

export function switchTask(invocation: Invocation): Body {
  const { entry, input, variables } = invocation;
  const then = chosenFlow(entry.task, { data: input, variables, place: placeOf(invocation) });
  return then === undefined ? { output: input } : { output: input, flow: then };
}

export function forTask(invocation: Invocation): Promise<Body> {
  const { entry, input, variables } = invocation;
  const loop = objectField(entry.task, 'for') ?? {};
  const items = evaluateExpression(textField(loop, 'in') ?? 'null', input, variables, placeOf(invocation));
  if (!isList(items)) {
    throw raised('validation', 400, 'for.in must give an array to iterate over', entry.reference);
  }
  const release = invocation.scope.state.hold([items], entry.reference);
  return iterate({ invocation, loop, items, index: 0, data: input }).finally(release);
}

export async function forkTask(invocation: Invocation): Promise<Body> {
  const { entry, input, scope, runner } = invocation;
  const fork = objectField(entry.task, 'fork') ?? {};
  const branches = taskEntries(field(fork, 'branches'), `${entry.reference}/fork/branches`);
  const releases: Release[] = [];
  const holdingOutput = (outcome: TaskOutcome): TaskOutcome => {
    releases.push(scope.state.hold([outcome.output], entry.reference));
    return outcome;
  };
  const running = branches.map((branch) =>
    scope.state.host.cancellable(() => runner.runTask(branch, input, scope).then(holdingOutput)),
  );
  const cancelAll = (): void => {
    for (const branch of running) {
      branch.cancel();
    }
    for (const release of releases) {
      release();
    }
  };
  const results = running.map(({ result }) => result);
  try {
    if (field(fork, 'compete') === true) {
      const winner = await firstToSucceed(results);
      return withFlowOf([winner], winner.output);
    }
    const outcomes = await Promise.all(results);
    return withFlowOf(
      outcomes,
      outcomes.map(({ output }) => output),
    );
  } finally {
    cancelAll();
  }
}

async function iterate(iteration: Iteration): Promise<Body> {
  const { invocation, loop, items, index, data } = iteration;
  if (index >= items.length) {
    return { output: data };
  }
  const { entry, variables, scope, runner } = invocation;
  const loopVariables: Variables = {
    ...scope.variables,
    [textField(loop, 'each') ?? 'item']: items[index] ?? null,
    [textField(loop, 'at') ?? 'index']: index,
  };
  const conditionVariables = { ...variables, ...loopVariables, context: scope.state.context() };
  if (!holds(field(entry.task, 'while'), data, conditionVariables, placeOf(invocation))) {
    return { output: data };
  }
  const result = await runner.runList(field(entry.task, 'do'), `${entry.reference}/do`, data, {
    state: scope.state,
    variables: loopVariables,
  });
  return result.ending === 'completed'
    ? iterate({ ...iteration, index: index + 1, data: result.output })
    : bodyOf(result);
}

function firstToSucceed(results: readonly Promise<TaskOutcome>[]): Promise<TaskOutcome> {
  if (results.length === 0) {
    return Promise.resolve({ output: null, flow: 'continue' });
  }
  const contenders = results.map((result, index): Contender => ({
    index,
    settled: result.then(
      (outcome): Settlement => ({ index, outcome }),
      (failure: unknown): Settlement => ({ index, failure }),
    ),
  }));
  return raceForSuccess(contenders, []);
}

async function raceForSuccess(contenders: readonly Contender[], failures: readonly unknown[]): Promise<TaskOutcome> {
  if (contenders.length === 0) {
    throw failures[0];
  }
  const first = await Promise.race(contenders.map(({ settled }) => settled));
  if ('outcome' in first) {
    return first.outcome;
  }
  return raceForSuccess(
    contenders.filter(({ index }) => index !== first.index),
    [...failures, first.failure],
  );
}

function withFlowOf(outcomes: readonly TaskOutcome[], output: Json): Body {
  return outcomes.some(({ flow }) => flow === 'end') ? { output, flow: 'end' } : { output };
}
