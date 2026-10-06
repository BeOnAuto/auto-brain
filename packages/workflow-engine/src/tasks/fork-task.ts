import { field, objectField } from '../dsl/json.ts';
import { entryAt, taskEntries, type TaskEntry } from '../dsl/tasks.ts';
import type { Branch, FrameBody } from '../machine/run-state.ts';
import {
  doneOf,
  raisedOf,
  waitingOn,
  type BodyAdvance,
  type Invocation,
  type Machine,
  type Signal,
  type TaskAdvance,
} from '../runner/advance.ts';
import type { StepCause, StepKey } from '../steps/step-entry.ts';

type ForkBody = Extract<FrameBody, { readonly kind: 'fork' }>;

type Failed = Extract<Branch, { readonly state: 'failed' }>;

type Finished = Extract<Branch, { readonly state: 'finished' }>;

interface Moved {
  readonly branches: readonly Branch[];
  readonly causes: readonly (StepCause | undefined)[];
  readonly last: StepCause;
}

function entriesOf(invocation: Invocation): readonly TaskEntry[] {
  const { reference } = invocation.entry;
  return taskEntries(field(objectField(invocation.entry.task, 'fork') ?? {}, 'branches'), `${reference}/fork/branches`);
}

function forkStarted({ frame }: Invocation): StepKey {
  return { reference: frame.reference, run: frame.run, outcome: 'started', times: 1 };
}

function failuresIn(branches: readonly Branch[]): number {
  return branches.filter(({ state }) => state === 'failed').length;
}

function branchOf(advance: TaskAdvance, order: number): Branch {
  if (advance.kind === 'waiting') {
    return { state: 'running', task: advance.frame };
  }
  return advance.kind === 'done'
    ? { state: 'finished', output: advance.output, flow: advance.flow }
    : { state: 'failed', error: advance.error, order };
}

function started(invocation: Invocation, entry: TaskEntry, order: number): Branch {
  const { machine, frame } = invocation;
  const { session } = machine;
  if (session.meter.shouldYield()) {
    const label = `${entry.reference} lets other workflows run`;
    return {
      state: 'yielding',
      timer: session.timers.arm({ purpose: 'yield', reference: entry.reference, milliseconds: 0, label }),
    };
  }
  return branchOf(machine.runner.startTask(machine, entry, frame.input, frame.variables), order);
}

function cancelBranch(machine: Machine, branch: Branch): void {
  if (branch.state === 'yielding') {
    machine.session.timers.disarm(branch.timer);
  }
  if (branch.state === 'running') {
    machine.runner.cancelTask(machine, branch.task);
  }
}

function isUnsettled({ state }: Branch): boolean {
  return state === 'running' || state === 'yielding';
}

function firstFailure(branches: readonly Branch[]): Failed | undefined {
  return branches
    .filter((branch): branch is Failed => branch.state === 'failed')
    .toSorted((first, second) => first.order - second.order)[0];
}

function causedByBranch(invocation: Invocation, moved: Moved, decisive: Branch | undefined): void {
  const at = decisive === undefined ? -1 : moved.branches.indexOf(decisive);
  invocation.machine.session.causedBy(moved.causes[at] ?? moved.last);
}

function cancelledAll(invocation: Invocation, branches: readonly Branch[]): void {
  for (const branch of branches) {
    cancelBranch(invocation.machine, branch);
  }
}

function finishedAll(invocation: Invocation, branches: readonly Branch[]): BodyAdvance {
  const finished = branches.filter((branch): branch is Finished => branch.state === 'finished');
  const { session } = invocation.machine;
  const outputs = finished.map(({ output }) => session.valueOf(output));
  return doneOf(session.hold(outputs), finished.some(({ flow }) => flow === 'end') ? 'end' : null);
}

function settledTogether(invocation: Invocation, moved: Moved): BodyAdvance {
  const { branches } = moved;
  const failure = firstFailure(branches);
  causedByBranch(invocation, moved, failure);
  if (failure !== undefined) {
    cancelledAll(invocation, branches);
    return raisedOf(failure.error);
  }
  return branches.some((branch) => isUnsettled(branch))
    ? waitingOn({ kind: 'fork', compete: false, branches })
    : finishedAll(invocation, branches);
}

function settledCompeting(invocation: Invocation, moved: Moved): BodyAdvance {
  const { branches } = moved;
  const winner = branches.find((branch): branch is Finished => branch.state === 'finished');
  causedByBranch(invocation, moved, winner);
  if (winner !== undefined) {
    cancelledAll(invocation, branches);
    return doneOf(winner.output, winner.flow === 'end' ? 'end' : null);
  }
  if (branches.some((branch) => isUnsettled(branch))) {
    return waitingOn({ kind: 'fork', compete: true, branches });
  }
  const failure = firstFailure(branches);
  return failure === undefined ? doneOf(invocation.machine.session.hold(null)) : raisedOf(failure.error);
}

function settled(invocation: Invocation, compete: boolean, moved: Moved): BodyAdvance {
  return compete ? settledCompeting(invocation, moved) : settledTogether(invocation, moved);
}

export function startFork(invocation: Invocation): BodyAdvance {
  const { session } = invocation.machine;
  const compete = field(objectField(invocation.entry.task, 'fork') ?? {}, 'compete') === true;
  const branches: Branch[] = [];
  const causes: StepCause[] = [];
  for (const entry of entriesOf(invocation)) {
    session.causedBy(forkStarted(invocation));
    branches.push(started(invocation, entry, failuresIn(branches)));
    causes.push(session.cause());
  }
  return settled(invocation, compete, { branches, causes, last: session.cause() });
}

function resumedBranch(invocation: Invocation, branch: Branch, signal: Signal, order: number): Branch {
  const { machine, frame } = invocation;
  if (branch.state === 'yielding' && signal.kind === 'timer' && signal.timerId === branch.timer) {
    const entry = entryAt(machine.session.document(), signal.timer.reference);
    machine.session.causedBy(forkStarted(invocation));
    return branchOf(machine.runner.startTask(machine, entry, frame.input, frame.variables), order);
  }
  const advance = branch.state === 'running' ? machine.runner.resumeTask(machine, branch.task, signal) : undefined;
  return advance === undefined ? branch : branchOf(advance, order);
}

export function resumeFork(invocation: Invocation, body: ForkBody, signal: Signal): BodyAdvance | undefined {
  const { session } = invocation.machine;
  const before = session.cause();
  const branches: Branch[] = [];
  const causes: (StepCause | undefined)[] = [];
  let last = before;
  for (const [index, branch] of body.branches.entries()) {
    const order = failuresIn([...branches, ...body.branches.slice(index)]);
    session.causedBy(before);
    const resumed = resumedBranch(invocation, branch, signal, order);
    const moved = resumed === branch ? undefined : session.cause();
    branches.push(resumed);
    causes.push(moved);
    last = moved ?? last;
  }
  return branches.every((branch, index) => branch === body.branches[index])
    ? undefined
    : settled(invocation, body.compete, { branches, causes, last });
}

export function cancelFork(machine: Machine, body: ForkBody): void {
  for (const branch of body.branches) {
    cancelBranch(machine, branch);
  }
}
