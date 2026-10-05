import type { DslError } from '@beonauto/workflow-engine';
import type { Variables } from '@beonauto/workflow-engine/dsl/expressions';
import { field, objectField, textField, type JsonObject } from '@beonauto/workflow-engine/dsl/json';
import { RaisedError, errorAsJson } from '@beonauto/workflow-engine/dsl/raised-error';
import {
  attemptDuration,
  retryDelay,
  retryPolicyOf,
  type RetryContext,
  type RetryState,
} from '@beonauto/workflow-engine/dsl/retry-policy';
import { catches, raisedBy } from '@beonauto/workflow-engine/dsl/task-outcomes';

import { bodyOf, type Body, type Invocation } from './invocation.ts';
import { placeOf } from './place.ts';
import { withTimeout } from './timeouts.ts';

interface Attempt extends RetryState {
  readonly invocation: Invocation;
  readonly handler: JsonObject;
}

export function raiseTask(invocation: Invocation): never {
  const { entry, input, variables, scope } = invocation;
  throw raisedBy(entry.task, scope.state.components.errors, { data: input, variables, place: placeOf(invocation) });
}

export function tryTask(invocation: Invocation): Promise<Body> {
  const handler = objectField(invocation.entry.task, 'catch') ?? {};
  return attempt({ invocation, handler, attempt: 0, startedAt: invocation.scope.state.host.now() });
}

async function attempt(current: Attempt): Promise<Body> {
  const { invocation, handler } = current;
  const { entry, input, scope, runner } = invocation;
  const policy = retryPolicyOf(field(handler, 'retry'), scope.state.components.retries, entry.reference);
  const deadline = {
    milliseconds: attemptDuration(policy, retryContextOf(invocation, invocation.variables)),
    reference: entry.reference,
  };
  try {
    return bodyOf(
      await withTimeout(scope.state, deadline, () =>
        runner.runList(field(entry.task, 'try'), `${entry.reference}/try`, input, scope),
      ),
    );
  } catch (error) {
    if (!(error instanceof RaisedError)) {
      throw error;
    }
    return handle(current, error.error, policy);
  }
}

async function handle(current: Attempt, error: DslError, policy: JsonObject | undefined): Promise<Body> {
  const { invocation, handler } = current;
  const { entry, scope } = invocation;
  const errorName = textField(handler, 'as') ?? 'error';
  const errorVariables = { ...invocation.variables, [errorName]: errorAsJson(error) };
  if (!catches(handler, error, { data: invocation.input, variables: errorVariables, place: placeOf(invocation) })) {
    throw new RaisedError(error);
  }
  const delay =
    policy === undefined ? undefined : retryDelay(policy, current, retryContextOf(invocation, errorVariables));
  if (delay === undefined) {
    const caught = errorAsJson(error);
    const release = scope.state.hold([caught], entry.reference);
    return recover(invocation, handler, { [errorName]: caught }).finally(release);
  }
  scope.state.beforeWaiting(entry.reference);
  await scope.state.host.sleep(delay, `${entry.reference} retry ${current.attempt + 1}`);
  return attempt({ ...current, attempt: current.attempt + 1 });
}

async function recover(invocation: Invocation, handler: JsonObject, errorVariables: Variables): Promise<Body> {
  const { entry, input, scope, runner } = invocation;
  const recovery = field(handler, 'do');
  if (recovery === undefined) {
    return { output: input };
  }
  const result = await runner.runList(recovery, `${entry.reference}/catch/do`, input, {
    state: scope.state,
    variables: { ...scope.variables, ...errorVariables },
  });
  return bodyOf(result);
}

function retryContextOf(invocation: Invocation, variables: Variables): RetryContext {
  return { draw: invocation.scope.state.host.random, data: invocation.input, variables, place: placeOf(invocation) };
}
