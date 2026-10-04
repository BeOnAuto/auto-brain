import { field, jsonBytesOf, objectField, type Json } from '@beonauto/workflow-engine/dsl/json';
import { rejectionsOf } from '@beonauto/workflow-engine/dsl/policy';

import { placeIn, transform } from './evaluation.ts';
import type { WorkflowHost } from './host.ts';
import { RaisedError, errorType } from './raised-error.ts';
import { admitted, runtimeDescriptor, makeRunState, type RunState } from './run-state.ts';
import { endingOf, settlementOf, type RunOutcome, type WorkflowEnding } from './settlement.ts';
import { runList } from './task-runner.ts';
import { timeoutOf, withTimeout } from './timeouts.ts';
import { readWorkflowRun } from './workflow-run.ts';

export interface WorkflowStart {
  readonly deliver: (event: unknown) => void;
  readonly ending: Promise<WorkflowEnding>;
}

const mostOutputBytes = 1_048_574;

const deadlineMargin = 3_600_000;

const root = '/';

export function startWorkflow(input: unknown, host: WorkflowHost): WorkflowStart {
  const run = readWorkflowRun(input);
  if (run === undefined) {
    return {
      deliver: ignoreEvent,
      ending: Promise.resolve({
        kind: 'faulted',
        type: 'InvalidRun',
        message: 'The workflow was started without a run it can read',
      }),
    };
  }
  const state = makeRunState(run, host);
  return { deliver: state.deliver, ending: finish(state) };
}

function ignoreEvent(): void {}

async function finish(state: RunState): Promise<WorkflowEnding> {
  const outcome = await outcomeBeforeDeadline(state);
  const { org, brain, id, spec } = state.run.execution;
  await state.host.settle({ org, brain, spec: spec.name, executionId: id, settlement: settlementOf(outcome) });
  return endingOf(outcome);
}

async function outcomeBeforeDeadline(state: RunState): Promise<RunOutcome> {
  const { host, run } = state;
  const milliseconds = run.mostDuration - deadlineMargin;
  const deadline = host.cancellable(() => host.deadline(milliseconds));
  const overflowing = host.cancellable(() => host.watch(() => state.overflow() !== undefined));
  const job = host.cancellable(() => outcomeOf(state));
  let overran = false;
  const stopJob = (): boolean => {
    job.cancel();
    return true;
  };
  void deadline.result.then(() => {
    overran = true;
    return stopJob();
  }, stopped);
  void overflowing.result.then(stopJob, stopped);
  try {
    const outcome = await job.result;
    const overflow = state.overflow();
    if (overran) {
      return { kind: 'overran', milliseconds };
    }
    return overflow === undefined ? outcome : { kind: 'raised', error: overflow.error };
  } finally {
    deadline.cancel();
    overflowing.cancel();
  }
}

function stopped(): boolean {
  return false;
}

async function outcomeOf(state: RunState): Promise<RunOutcome> {
  try {
    return withinOutputLimit(await interpret(state));
  } catch (error) {
    if (error instanceof RaisedError) {
      return { kind: 'raised', error: error.error };
    }
    return state.host.isCancellation(error)
      ? { kind: 'cancelled', cause: error }
      : { kind: 'broken', reason: `The workflow broke down: ${String(error)}` };
  }
}

async function interpret(state: RunState): Promise<Json> {
  const { document, input } = state.run;
  const rejections = rejectionsOf(document).filter(({ forbidden }) => forbidden);
  if (rejections.length > 0) {
    throw new RaisedError({
      type: errorType('configuration'),
      status: 400,
      title: 'The workflow document is not allowed by this runtime',
      detail: rejections.map(({ pointer, detail }) => `${pointer}: ${detail}`).join('; '),
      instance: root,
    });
  }
  state.hold([document, admitted(input, root)], root);
  const variables = { workflow: state.workflow, runtime: runtimeDescriptor };
  const place = placeIn(state, root);
  const transformed = transform(field(objectField(document, 'input') ?? {}, 'from'), input, variables, place);
  const timeout = timeoutOf(state, {
    declared: field(document, 'timeout'),
    data: transformed,
    variables,
    reference: root,
  });
  const result = await withTimeout(state, { milliseconds: timeout, reference: root }, () =>
    runList(field(document, 'do'), '/do', transformed, { state, variables: {} }),
  );
  return admitted(
    transform(
      field(objectField(document, 'output') ?? {}, 'as'),
      result.output,
      { ...variables, context: state.context() },
      placeIn(state, root),
    ),
    root,
  );
}

function withinOutputLimit(output: Json): RunOutcome {
  const bytes = jsonBytesOf(output);
  return bytes > mostOutputBytes ? { kind: 'oversized', bytes, most: mostOutputBytes } : { kind: 'completed', output };
}
