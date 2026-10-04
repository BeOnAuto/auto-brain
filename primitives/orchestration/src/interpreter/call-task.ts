import { field, isObject, jsonBytesOf, textField, type Json } from '@beonauto/workflow-engine/dsl/json';

import { executeSpecFunction } from '../document/workflow-functions.ts';
import { evaluateTemplate, placeOf } from './evaluation.ts';
import type { SpecCall, SpecCallResult } from './host.ts';
import type { Body, Invocation } from './invocation.ts';
import { RaisedError, errorType, raised, type ErrorKind } from './raised-error.ts';
import type { RunState } from './run-state.ts';

interface SpecArguments {
  readonly primitive: string;
  readonly name: string;
  readonly input: Json;
}

type Classification = readonly [ErrorKind, number];

const mostSpecInputBytes = 262_144;

const rejections: Readonly<Record<string, Classification>> = {
  invalid_input: ['validation', 400],
  forbidden: ['authorization', 403],
  not_found: ['configuration', 404],
  conflict: ['runtime', 409],
  unavailable: ['communication', 503],
};

export async function callTask(invocation: Invocation): Promise<Body> {
  const { entry, input, variables, scope, run } = invocation;
  const { reference } = entry;
  const spec = specArguments(
    evaluateTemplate(field(entry.task, 'with') ?? null, input, variables, placeOf(invocation)),
    reference,
  );
  const { state } = scope;
  const { org, brain } = state.run.execution;
  state.beforeWaiting(reference);
  const result = await executed(state, { org, brain, caller: state.run.caller, reference, run, ...spec });
  return bodyOf(result, spec, reference);
}

async function executed(state: RunState, call: SpecCall): Promise<SpecCallResult> {
  try {
    return await state.host.executeSpec(call, state.run.longestNestedExecutionMs);
  } catch (error) {
    if (state.host.isCancellation(error)) {
      throw error;
    }
    throw new RaisedError({
      type: errorType('communication'),
      status: 503,
      title: `${executeSpecFunction} could not reach the ${call.primitive} spec ${call.name}`,
      detail: failureChain(error),
      instance: call.reference,
    });
  }
}

function failureChain(error: unknown): string {
  return error instanceof Error && error.cause !== undefined
    ? `${String(error)}: ${failureChain(error.cause)}`
    : String(error);
}

function specArguments(arguments_: Json, reference: string): SpecArguments {
  if (!isObject(arguments_)) {
    throw raised('validation', 400, `${executeSpecFunction} takes with: { primitive, name, input }`, reference);
  }
  const primitive = textField(arguments_, 'primitive');
  const name = textField(arguments_, 'name');
  if (primitive === undefined || name === undefined) {
    throw raised('validation', 400, `${executeSpecFunction} needs a string primitive and a string name`, reference);
  }
  if (primitive === 'orchestration') {
    throw raised('configuration', 400, 'A workflow cannot execute another workflow in this version', reference);
  }
  const input = field(arguments_, 'input') ?? {};
  const bytes = jsonBytesOf(input);
  if (bytes > mostSpecInputBytes) {
    throw raised(
      'validation',
      400,
      `The input of ${executeSpecFunction} takes ${bytes} bytes as JSON, more than the ${mostSpecInputBytes} an execution takes`,
      reference,
    );
  }
  return { primitive, name, input };
}

function bodyOf(result: SpecCallResult, spec: SpecArguments, reference: string): Body {
  if (result.status === 'succeeded') {
    return { output: result.output };
  }
  const [kind, status]: Classification =
    result.status === 'rejected' ? (rejections[result.reason] ?? ['runtime', 500]) : ['runtime', 500];
  throw new RaisedError({
    type: errorType(kind),
    status,
    title:
      result.status === 'rejected'
        ? `The ${spec.primitive} spec ${spec.name} rejected the execution with ${result.reason}`
        : `The ${spec.primitive} spec ${spec.name} failed`,
    detail: result.detail,
    instance: reference,
  });
}
