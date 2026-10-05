import { evaluateTemplate } from '@beonauto/workflow-engine/dsl/evaluation';
import { field, type Json } from '@beonauto/workflow-engine/dsl/json';
import { RaisedError, callErrorOf, raised, type CallSite } from '@beonauto/workflow-engine/dsl/raised-error';

import { failureChain, isArgumentsProblem, specArgumentsOf, type SpecArguments } from '../document/spec-arguments.ts';
import { executeSpecFunction } from '../document/workflow-functions.ts';
import type { SpecCall, SpecCallResult } from './host.ts';
import type { Body, Invocation } from './invocation.ts';
import { placeOf } from './place.ts';
import type { RunState } from './run-state.ts';

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
    throw new RaisedError(
      callErrorOf({ status: 'unreachable', detail: failureChain(error) }, siteOf(call, call.reference)),
    );
  }
}

function specArguments(arguments_: Json, reference: string): SpecArguments {
  const spec = specArgumentsOf(arguments_);
  if (isArgumentsProblem(spec)) {
    throw raised(spec.kind, 400, spec.title, reference);
  }
  return spec;
}

function siteOf(spec: SpecArguments, reference: string): CallSite {
  return { function: executeSpecFunction, label: `the ${spec.primitive} spec ${spec.name}`, reference };
}

function bodyOf(result: SpecCallResult, spec: SpecArguments, reference: string): Body {
  if (result.status === 'succeeded') {
    return { output: result.output };
  }
  throw new RaisedError(callErrorOf(result, siteOf(spec, reference)));
}
