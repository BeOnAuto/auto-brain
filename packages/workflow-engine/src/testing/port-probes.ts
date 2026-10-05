import type { CallResult } from '@beonauto/operations';
import { Effect } from 'effect';

import type { RunContext } from '../dispatch/dispatch-watermark.ts';
import type { ArmTimer, StartCall } from '../dispatch/run-output.ts';
import { callKeyText } from '../executor/call-key.ts';
import type { Executor } from '../executor/executor.ts';
import type { Timers } from '../timers/timers.ts';

export interface Probe<Subject> {
  readonly title: string;
  readonly expected: readonly string[];
  readonly run: (subject: Subject) => Effect.Effect<readonly string[], unknown>;
}

export interface TimerSubject {
  readonly timers: Timers;
  readonly run: RunContext;
  readonly now: () => number;
  readonly settle: () => Effect.Effect<readonly string[], unknown>;
}

export interface ExecutorSubject {
  readonly executor: Executor;
  readonly run: RunContext;
  readonly finish: (call: StartCall, result: CallResult) => Effect.Effect<void, unknown>;
  readonly loseHost: (call: StartCall) => Effect.Effect<void, unknown>;
  readonly settle: () => Effect.Effect<readonly string[], unknown>;
}

function timerOf({ run, now }: TimerSubject, sequence: number): ArmTimer {
  return {
    kind: 'arm_timer',
    executionId: run.executionId,
    timerId: `${run.executionId}/timers/${sequence}`,
    dueAt: now() + 1000,
    purpose: 'wait',
  };
}

function cancelOf({ executionId, timerId }: ArmTimer): {
  readonly kind: 'cancel_timer';
  readonly executionId: string;
  readonly timerId: string;
} {
  return { kind: 'cancel_timer', executionId, timerId };
}

function firedOf(timerIds: readonly string[]): string {
  return timerIds.length === 0
    ? 'fired nothing'
    : `fired ${timerIds.map((id) => id.slice(id.lastIndexOf('/') + 1)).join(' ')}`;
}

export const timerProbes: readonly Probe<TimerSubject>[] = [
  {
    title: 'arms a timer once and fires it once',
    expected: ['armed', 'already_armed', 'fired 1', 'already_armed', 'already_fired'],
    run: (subject) =>
      Effect.gen(function* () {
        const timer = timerOf(subject, 1);
        const first = yield* subject.timers.arm(timer, subject.run);
        const again = yield* subject.timers.arm(timer, subject.run);
        const fired = yield* subject.settle();
        const afterFiring = yield* subject.timers.arm(timer, subject.run);
        const cancel = yield* subject.timers.cancel(cancelOf(timer), subject.run);
        return [first, again, firedOf(fired), afterFiring, cancel];
      }),
  },
  {
    title: 'never fires a timer it cancelled',
    expected: ['armed', 'cancelled', 'fired nothing'],
    run: (subject) =>
      Effect.gen(function* () {
        const timer = timerOf(subject, 2);
        const armed = yield* subject.timers.arm(timer, subject.run);
        const cancelled = yield* subject.timers.cancel(cancelOf(timer), subject.run);
        return [armed, cancelled, firedOf(yield* subject.settle())];
      }),
  },
  {
    title: 'refuses to arm a timer cancelled before it was armed',
    expected: ['tombstoned', 'refused_after_cancel', 'fired nothing'],
    run: (subject) =>
      Effect.gen(function* () {
        const timer = timerOf(subject, 3);
        const cancelled = yield* subject.timers.cancel(cancelOf(timer), subject.run);
        const refused = yield* subject.timers.arm(timer, subject.run);
        return [cancelled, refused, firedOf(yield* subject.settle())];
      }),
  },
  {
    title: 'arms again, when swept, a timer it lost, and no timer it has',
    expected: ['armed', 'swept 1', 'fired 4 5', 'swept 0'],
    run: (subject) =>
      Effect.gen(function* () {
        const kept = timerOf(subject, 4);
        const lost = timerOf(subject, 5);
        const armed = yield* subject.timers.arm(kept, subject.run);
        const swept = yield* subject.timers.sweep(subject.run, [kept, lost]);
        const fired = yield* subject.settle();
        const sweptAgain = yield* subject.timers.sweep(subject.run, [kept, lost]);
        return [armed, `swept ${swept}`, firedOf(fired), `swept ${sweptAgain}`];
      }),
  },
];

function callOf({ run }: ExecutorSubject, reference: string): StartCall {
  return {
    kind: 'start_call',
    key: { executionId: run.executionId, reference, run: 1 },
    function: 'notify',
    arguments: { to: 'ada' },
    longestMs: 60_000,
  };
}

function cancelCallOf({ key }: StartCall): { readonly kind: 'cancel_call'; readonly key: StartCall['key'] } {
  return { kind: 'cancel_call', key };
}

function answeredOf(subject: ExecutorSubject, call: StartCall): Effect.Effect<string, unknown> {
  const key = callKeyText(call.key);
  return Effect.map(
    subject.settle(),
    (answered) => `answered ${answered.filter((answeredKey) => answeredKey === key).length} of ${answered.length}`,
  );
}

const succeeded: CallResult = { status: 'succeeded', output: 'sent' };

export const executorProbes: readonly Probe<ExecutorSubject>[] = [
  {
    title: 'answers a call once, and gives the answer again to a start that comes after it',
    expected: ['started', 'running', 'answered 1 of 1', 'answered_again', 'answered 1 of 1', 'already_answered'],
    run: (subject) =>
      Effect.gen(function* () {
        const call = callOf(subject, '/do/0/first');
        const started = yield* subject.executor.start(call, subject.run);
        const running = yield* subject.executor.start(call, subject.run);
        yield* subject.finish(call, succeeded);
        const answered = yield* answeredOf(subject, call);
        const again = yield* subject.executor.start(call, subject.run);
        const answeredAgain = yield* answeredOf(subject, call);
        const cancel = yield* subject.executor.cancel(cancelCallOf(call), subject.run);
        return [started, running, answered, again, answeredAgain, cancel];
      }),
  },
  {
    title: 'refuses to start a call cancelled before it started',
    expected: ['tombstoned', 'refused_after_cancel', 'answered 0 of 0'],
    run: (subject) =>
      Effect.gen(function* () {
        const call = callOf(subject, '/do/0/second');
        const cancelled = yield* subject.executor.cancel(cancelCallOf(call), subject.run);
        const refused = yield* subject.executor.start(call, subject.run);
        return [cancelled, refused, yield* answeredOf(subject, call)];
      }),
  },
  {
    title: 'starts again a call whose host died before it answered',
    expected: ['started', 'started_again', 'answered 1 of 1'],
    run: (subject) =>
      Effect.gen(function* () {
        const call = callOf(subject, '/do/0/third');
        const started = yield* subject.executor.start(call, subject.run);
        yield* subject.loseHost(call);
        const again = yield* subject.executor.start(call, subject.run);
        yield* subject.finish(call, succeeded);
        return [started, again, yield* answeredOf(subject, call)];
      }),
  },
  {
    title: 'cancels a call it is running',
    expected: ['started', 'cancelled', 'answered 0 of 0'],
    run: (subject) =>
      Effect.gen(function* () {
        const call = callOf(subject, '/do/0/fourth');
        const started = yield* subject.executor.start(call, subject.run);
        const cancelled = yield* subject.executor.cancel(cancelCallOf(call), subject.run);
        return [started, cancelled, yield* answeredOf(subject, call)];
      }),
  },
];
