import { millisecondsOf, transform, type Place } from '../dsl/evaluation.ts';
import { raised } from '../dsl/raised-error.ts';
import { chosenFlow, raisedBy, type Site } from '../dsl/task-outcomes.ts';
import type { FrameBody } from '../machine/run-state.ts';
import { doneOf, waitingOn, type BodyAdvance, type Invocation, type Machine, type Signal } from '../runner/advance.ts';

type WaitBody = Extract<FrameBody, { readonly kind: 'wait' }>;

function placeOf({ machine, entry }: Invocation): Place {
  return machine.session.placeAt(entry.reference);
}

export function startSet(invocation: Invocation): BodyAdvance {
  const { machine, configuration, input, variables } = invocation;
  return doneOf(machine.session.hold(transform(configuration, input, variables, placeOf(invocation))));
}

function siteOf(invocation: Invocation): Site {
  return { data: invocation.input, variables: invocation.variables, place: placeOf(invocation) };
}

export function startSwitch(invocation: Invocation): BodyAdvance {
  return doneOf(invocation.frame.input, chosenFlow(invocation.entry.task, siteOf(invocation)) ?? null);
}

export function startRaise(invocation: Invocation): BodyAdvance {
  throw raisedBy(invocation.entry.task, invocation.machine.session.components().errors, siteOf(invocation));
}

export function startRejected({ entry }: Invocation): BodyAdvance {
  throw raised('configuration', 400, 'emit and run tasks are not allowed by this runtime', entry.reference);
}

export function startWait(invocation: Invocation): BodyAdvance {
  const { machine, entry, frame, configuration, input, variables } = invocation;
  const milliseconds = millisecondsOf(configuration, input, variables, placeOf(invocation));
  machine.session.beforeWaiting();
  const timer = machine.session.timers.arm({
    purpose: 'wait',
    reference: entry.reference,
    milliseconds,
    label: entry.reference,
  });
  machine.session.record(entry.reference, frame.run, 'waiting');
  return waitingOn({ kind: 'wait', timer });
}

export function resumeWait({ frame }: Invocation, body: WaitBody, signal: Signal): BodyAdvance | undefined {
  return signal.kind === 'timer' && signal.timerId === body.timer ? doneOf(frame.input) : undefined;
}

export function cancelWait(machine: Machine, body: WaitBody): void {
  machine.session.timers.disarm(body.timer);
}
