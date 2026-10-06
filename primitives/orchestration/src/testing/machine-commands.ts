import type { CallResult } from '@beonauto/operations';
import type { CallKey, Json, RunOutput } from '@beonauto/workflow-engine';
import type { Dispatched } from '@beonauto/workflow-engine/testing';

import { failureChain, isArgumentsProblem, specArgumentsOf } from '../document/spec-arguments.ts';
import type { Command } from './machine-host.ts';
import type { SpecCall, SpecCallResult, WorkflowRun } from './run-terms.ts';

export type SpecResponder = (call: SpecCall) => SpecCallResult | Promise<SpecCallResult>;

function specCallOf(run: WorkflowRun, arguments_: Json, key: CallKey): SpecCall | CallResult {
  const spec = specArgumentsOf(arguments_);
  if (isArgumentsProblem(spec)) {
    return { status: 'rejected', reason: 'invalid_arguments', detail: spec.title };
  }
  const { org, brain } = run.execution;
  return { org, brain, caller: run.caller, reference: key.reference, run: key.run, ...spec };
}

function isSpecCall(value: SpecCall | CallResult): value is SpecCall {
  return 'reference' in value;
}

export function answerOf(
  run: WorkflowRun,
  respond: SpecResponder,
  key: CallKey,
  arguments_: Json,
): Promise<CallResult> {
  const call = specCallOf(run, arguments_, key);
  if (!isSpecCall(call)) {
    return Promise.resolve(call);
  }
  return Promise.resolve(call)
    .then(respond)
    .then(
      (result): CallResult => result,
      (error: unknown): CallResult => ({ status: 'unreachable', detail: failureChain(error) }),
    );
}

function armCommand(
  labels: Map<string, string>,
  output: Extract<RunOutput, { readonly kind: 'arm_timer' }>,
  at: number,
): readonly Command[] {
  if (output.purpose === 'deadline') {
    return [{ kind: 'deadline', milliseconds: output.dueAt - at }];
  }
  const summary = output.purpose === 'call_deadline' ? undefined : output.label;
  if (summary === undefined) {
    return [];
  }
  labels.set(output.timerId, summary);
  return [{ kind: 'timer', milliseconds: output.dueAt - at, summary }];
}

function commandOf(run: WorkflowRun, labels: Map<string, string>, { at, output }: Dispatched): readonly Command[] {
  if (output.kind === 'arm_timer') {
    return armCommand(labels, output, at);
  }
  if (output.kind === 'cancel_timer') {
    const summary = labels.get(output.timerId);
    return summary === undefined ? [] : [{ kind: 'cancelled', summary }];
  }
  if (output.kind === 'start_call') {
    const call = specCallOf(run, output.arguments, output.key);
    return isSpecCall(call) ? [{ kind: 'call', call }] : [];
  }
  if (output.kind === 'cancel_call') {
    return [{ kind: 'cancelled', summary: output.key.reference }];
  }
  const { org, brain, id, spec } = run.execution;
  return [{ kind: 'settle', request: { org, brain, spec: spec.name, executionId: id, settlement: output.settlement } }];
}

export function commandsOf(run: WorkflowRun, dispatched: readonly Dispatched[]): readonly Command[] {
  const labels = new Map<string, string>();
  return dispatched.flatMap((entry) => commandOf(run, labels, entry));
}
