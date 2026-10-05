import type { ArmTimer, RunOutput } from '../dispatch/run-output.ts';
import type { Json, JsonObject } from '../dsl/json.ts';
import type { RunLimits } from '../machine/run-input.ts';
import { newRun, type ArmedTimer, type RunOutcome, type RunState } from '../machine/run-state.ts';
import type { Responder } from '../memory/memory-executor.ts';
import type { PositionedEvent, Step } from '../run-log/run-event.ts';
import { evolveRun } from '../run-log/run-fold.ts';
import type { TimerPurpose } from '../timers/timer-id.ts';
import { memoryDriver, type MemoryDriver } from './memory-driver.ts';

export const drivenExecutionId = '0199a3c4-7d2e-7c1a-9b3f-2f1e0d9c8b7a';

export interface DriveOptions {
  readonly input?: Json;
  readonly respond?: Responder;
  readonly limits?: Partial<RunLimits>;
  readonly seed?: number;
  readonly meanwhile?: (driver: MemoryDriver, executionId: string) => void;
}

export interface DrivenRun {
  readonly driver: MemoryDriver;
  readonly ended: RunState;
  readonly outcome: RunOutcome | null;
  readonly events: readonly PositionedEvent[];
}

export function drivenRun(document: JsonObject, options: DriveOptions = {}): DrivenRun {
  const { input, respond, limits, seed, meanwhile } = options;
  const driver = memoryDriver(respond === undefined ? {} : { respond });
  const executionId = drivenExecutionId;
  driver.start({
    executionId,
    document,
    ...(input === undefined ? {} : { input }),
    ...(limits === undefined ? {} : { limits }),
    ...(seed === undefined ? {} : { seed }),
  });
  meanwhile?.(driver, executionId);
  const ended = driver.runUntilEnded(executionId);
  return { driver, ended, outcome: ended.outcome, events: driver.ports.runStore.events(executionId) };
}

export function statesAlong(events: readonly PositionedEvent[]): readonly RunState[] {
  const states: RunState[] = [];
  let state = newRun;
  for (const { event } of events) {
    state = evolveRun(state, event);
    states.push(state);
  }
  return states;
}

export function armedTimersAlong(events: readonly PositionedEvent[]): readonly (readonly string[])[] {
  return statesAlong(events).map((state) =>
    Object.values(state.timers.armed)
      .map(({ purpose, reference }: ArmedTimer) => `${purpose} ${reference}`)
      .toSorted(),
  );
}

export function outputsIn(events: readonly PositionedEvent[]): readonly RunOutput[] {
  return events.flatMap(({ event }) => event.outputs);
}

export function outputKindsIn(events: readonly PositionedEvent[]): readonly RunOutput['kind'][] {
  return outputsIn(events).map(({ kind }) => kind);
}

export function stepsIn(events: readonly PositionedEvent[]): readonly Step[] {
  return events.flatMap(({ event }) => event.steps);
}

export function stepsWith(events: readonly PositionedEvent[], outcome: Step['outcome']): readonly Step[] {
  return stepsIn(events).filter((step) => step.outcome === outcome);
}

export function armedTimerIds(state: RunState, purpose: TimerPurpose): readonly string[] {
  return Object.entries(state.timers.armed)
    .filter(([, timer]: readonly [string, ArmedTimer]) => timer.purpose === purpose)
    .map(([timerId]: readonly [string, ArmedTimer]) => timerId);
}

export function timersArmedIn(events: readonly PositionedEvent[], purpose: TimerPurpose): readonly ArmTimer[] {
  return outputsIn(events).filter(
    (output): output is ArmTimer => output.kind === 'arm_timer' && output.purpose === purpose,
  );
}

export function timersCancelledIn(events: readonly PositionedEvent[]): readonly string[] {
  return outputsIn(events).flatMap((output) => (output.kind === 'cancel_timer' ? [output.timerId] : []));
}
