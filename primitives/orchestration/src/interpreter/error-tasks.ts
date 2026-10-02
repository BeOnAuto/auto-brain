import type { Variables } from '../dsl/expressions.ts';
import { entriesOf, field, isObject, objectField, textField, type JsonEntry, type JsonObject } from '../dsl/json.ts';
import { evaluateTemplate, holds, placeOf } from './evaluation.ts';
import { bodyOf, type Body, type Invocation } from './invocation.ts';
import { RaisedError, errorAsJson, errorFromJson, raised, type DslError } from './raised-error.ts';
import { attemptDuration, retryDelay, retryPolicyOf, type RetryContext, type RetryState } from './retry-policy.ts';
import { withTimeout } from './timeouts.ts';

interface Attempt extends RetryState {
  readonly invocation: Invocation;
  readonly handler: JsonObject;
}

const filterFields: Readonly<Record<string, string>> = { details: 'detail' };

export function raiseTask(invocation: Invocation): never {
  const { entry, input, variables, scope } = invocation;
  const declared = field(objectField(entry.task, 'raise') ?? {}, 'error');
  const definition = typeof declared === 'string' ? field(scope.state.components.errors, declared) : declared;
  const evaluated =
    definition === undefined ? null : evaluateTemplate(definition, input, variables, placeOf(invocation));
  const error = isObject(evaluated) ? errorFromJson(evaluated, entry.reference) : undefined;
  if (error === undefined) {
    throw raised('configuration', 400, 'raise names no error with a type and a status', entry.reference);
  }
  throw new RaisedError(error);
}

export function tryTask(invocation: Invocation): Promise<Body> {
  const handler = objectField(invocation.entry.task, 'catch') ?? {};
  return attempt({ invocation, handler, attempt: 0, startedAt: invocation.scope.state.host.now() });
}

async function attempt(current: Attempt): Promise<Body> {
  const { invocation, handler } = current;
  const { entry, input, scope, runner } = invocation;
  const policy = retryPolicyOf(field(handler, 'retry'), scope.state, entry.reference);
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
  if (!catches(invocation, handler, error, errorVariables)) {
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

function catches(invocation: Invocation, handler: JsonObject, error: DslError, variables: Variables): boolean {
  const filter = objectField(objectField(handler, 'errors') ?? {}, 'with') ?? {};
  const raisedJson = errorAsJson(error);
  const place = placeOf(invocation);
  const exceptWhen = field(handler, 'exceptWhen');
  return (
    entriesOf(filter).every(([key, expected]: JsonEntry) => field(raisedJson, filterFields[key] ?? key) === expected) &&
    holds(field(handler, 'when'), invocation.input, variables, place) &&
    (exceptWhen === undefined || !holds(exceptWhen, invocation.input, variables, place))
  );
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
  return { state: invocation.scope.state, data: invocation.input, variables, place: placeOf(invocation) };
}
