import type { Json } from '../dsl/json.ts';
import { callKeyText, type CallKey } from '../executor/call-key.ts';
import type { ArmedTimer, RunState } from '../machine/run-state.ts';
import { timerIdOf, type TimerPurpose } from '../timers/timer-id.ts';
import type { Descriptors } from './run-descriptors.ts';
import type { Journal } from './run-tables.ts';

export interface TimerRequest {
  readonly purpose: TimerPurpose;
  readonly reference: string;
  readonly milliseconds: number;
  readonly label: string;
}

export interface TimerTable {
  readonly arm: (request: TimerRequest) => string;
  readonly disarm: (timerId: string | null) => void;
  readonly fire: (timerId: string) => readonly ArmedTimer[];
  readonly timerOf: (purpose: TimerPurpose, reference: string) => string | null;
  readonly disarmAll: () => void;
  readonly timers: () => RunState['timers'];
}

export interface CallRequest {
  readonly key: CallKey;
  readonly function: string;
  readonly arguments: Json;
}

export interface CallTable {
  readonly startCall: (request: CallRequest) => void;
  readonly answerCall: (key: CallKey) => void;
  readonly cancelCall: (key: CallKey) => void;
  readonly cancelAll: () => void;
  readonly calls: () => RunState['calls'];
}

export function timerTableOf(
  state: RunState,
  run: Pick<Descriptors, 'executionId'>,
  now: number,
  journal: Journal,
): TimerTable {
  const armed: Record<string, ArmedTimer> = { ...state.timers.armed };
  const counter = { next: state.timers.next };
  const disarm = (timerId: string | null): void => {
    if (timerId !== null && Object.hasOwn(armed, timerId)) {
      delete armed[timerId];
      journal.emit({ kind: 'cancel_timer', executionId: run.executionId(), timerId });
    }
  };
  return {
    arm: ({ purpose, reference, milliseconds, label }) => {
      const timerId = timerIdOf(run.executionId(), counter.next);
      counter.next += 1;
      const dueAt = now + Math.max(milliseconds, 0);
      armed[timerId] = { purpose, reference, armedAt: now, dueAt };
      journal.emit({ kind: 'arm_timer', executionId: run.executionId(), timerId, dueAt, purpose, label });
      return timerId;
    },
    disarm,
    fire: (timerId) => {
      const fired = Object.entries(armed).filter(([id]: readonly [string, ArmedTimer]) => id === timerId);
      delete armed[timerId];
      return fired.map(([, timer]: readonly [string, ArmedTimer]) => timer);
    },
    timerOf: (purpose, reference) =>
      Object.entries(armed).find(
        ([, timer]: readonly [string, ArmedTimer]) => timer.purpose === purpose && timer.reference === reference,
      )?.[0] ?? null,
    disarmAll: () => {
      for (const timerId of Object.keys(armed)) {
        disarm(timerId);
      }
    },
    timers: () => ({ next: counter.next, armed }),
  };
}

export function callTableOf(
  state: RunState,
  run: Pick<Descriptors, 'limits'>,
  timers: TimerTable,
  journal: Journal,
): CallTable {
  const calls: Record<string, CallKey> = { ...state.calls };
  const close = (key: CallKey): boolean => {
    const text = callKeyText(key);
    const open = Object.hasOwn(calls, text);
    delete calls[text];
    return open;
  };
  const disarmDeadline = (key: CallKey): void => {
    timers.disarm(timers.timerOf('call_deadline', key.reference));
  };
  const cancelCall = (key: CallKey): void => {
    if (close(key)) {
      journal.emit({ kind: 'cancel_call', key });
    }
    disarmDeadline(key);
  };
  return {
    startCall: ({ key, function: name, arguments: given }) => {
      calls[callKeyText(key)] = key;
      const longestMs = run.limits().longestCallMs;
      journal.emit({ kind: 'start_call', key, function: name, arguments: given, longestMs });
      const label = `${key.reference} deadline`;
      timers.arm({ purpose: 'call_deadline', reference: key.reference, milliseconds: longestMs, label });
    },
    answerCall: (key) => {
      close(key);
      disarmDeadline(key);
    },
    cancelCall,
    cancelAll: () => {
      for (const key of Object.values(calls)) {
        cancelCall(key);
      }
    },
    calls: () => calls,
  };
}
