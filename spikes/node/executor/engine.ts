import { Effect } from 'effect';

import { openLedger, type OpenLedger } from '../../../packages/ledger/src/testing/open-ledger.ts';
import type { Scheduler } from '../timers/scheduler.ts';
import { openTimerStore, type TimerStore } from '../timers/timer-store.ts';
import type { Clock } from './clocks.ts';
import { runDecider, runStreamOf, type RunInput, type RunOutput, type RunState } from './run-stream.ts';
import { jobDecider, jobStreamOf, watermarkDecider, watermarkStreamOf, type JobState } from './side-streams.ts';

export type CrashPoint = 'after-append' | 'after-dispatch' | undefined;

export class Crash extends Error {
  constructor(point: string) {
    super(`The process crashed ${point}`);
    this.name = 'Crash';
  }
}

export interface Evidence {
  readonly runVersion: number;
  readonly phase: RunState['phase'];
  readonly run: readonly string[];
  readonly outcomes: number;
  readonly consumedIds: readonly string[];
  readonly job: readonly string[];
  readonly watermark: number;
  readonly timers: readonly Record<string, unknown>[];
}

export interface Engine {
  readonly name: string;
  readonly submit: (executionId: string, messageId: string, input: RunInput, crash?: CrashPoint) => Promise<RunState>;
  readonly wake: (executionIds: readonly string[]) => Promise<void>;
  readonly fireDueTimers: () => Promise<number>;
  readonly nextTimerAt: () => number | undefined;
  readonly inspect: (executionId: string) => Promise<Evidence>;
  readonly effects: () => readonly string[];
  readonly close: () => Promise<void>;
  readonly attachScheduler: (scheduler: Scheduler) => void;
  readonly timers: TimerStore;
}

export interface EngineOptions {
  readonly name: string;
  readonly fileName: string;
  readonly clock: Clock;
  readonly resultDeliveries?: number;
  readonly timersFileName?: string;
}

function run<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

export async function openEngine(options: EngineOptions): Promise<Engine> {
  const { name, fileName, clock } = options;
  const opened: OpenLedger = await openLedger(fileName);
  const { ledger } = opened;
  const timers = openTimerStore(options.timersFileName ?? `${fileName}.timers`);
  const running = new Map<string, () => void>();
  const performed: string[] = [];
  let scheduler: Scheduler | undefined;
  let claims = 0;

  const loadRun = (executionId: string) => run(ledger.load(runStreamOf(executionId), runDecider));
  const loadJob = (key: string): Promise<JobState> =>
    run(ledger.load(jobStreamOf(key), jobDecider)).then(({ state }) => state);

  const submit = async (
    executionId: string,
    messageId: string,
    input: RunInput,
    crash?: CrashPoint,
  ): Promise<RunState> => {
    const { state } = await run(
      ledger.execute(runStreamOf(executionId), runDecider, { executionId, messageId, at: clock.now(), input }),
    );
    if (crash === 'after-append') {
      throw new Crash('after appending, before dispatching its outputs');
    }
    await dispatch(executionId, crash);
    return state;
  };

  const deliverResult = async (executionId: string, key: string, output: JobState['output']): Promise<void> => {
    await submit(executionId, `result:${key}`, { kind: 'call_answered', key, output: output ?? null });
  };

  const runStep = (executionId: string, key: string, stepMs: number): void => {
    performed.push(`${name} runs the step ${key} for ${stepMs} ms`);
    const stop = clock.after(stepMs, async () => {
      running.delete(key);
      const output = { score: 0.42, answeredBy: name };
      await run(ledger.execute(jobStreamOf(key), jobDecider, { kind: 'finish', at: clock.now(), output }));
      for (let delivery = 0; delivery < (options.resultDeliveries ?? 1); delivery += 1) {
        await deliverResult(executionId, key, output);
      }
    });
    running.set(key, stop);
  };

  const ensureJob = async (executionId: string, key: string, stepMs: number): Promise<void> => {
    const job = await loadJob(key);
    if (job.finished) {
      performed.push(`${name} finds ${key} finished and delivers its result again`);
      await deliverResult(executionId, key, job.output);
      return;
    }
    if (job.cancelled || running.has(key)) {
      performed.push(`${name} leaves ${key} alone (${job.cancelled ? 'cancelled' : 'running here'})`);
      return;
    }
    claims += 1;
    const claim = `${name}#${claims}`;
    const { state } = await run(
      ledger.execute(jobStreamOf(key), jobDecider, {
        kind: 'start',
        at: clock.now(),
        by: claim,
        restart: job.attempt > 0,
      }),
    );
    if (state.startedBy === claim) {
      runStep(executionId, key, stepMs);
    } else {
      performed.push(`${name} did not start ${key}: already started by ${state.startedBy ?? 'nobody'}`);
    }
  };

  const perform = async (executionId: string, output: RunOutput): Promise<void> => {
    if (output.kind === 'start_call') {
      await ensureJob(executionId, output.key, output.stepMs);
    } else if (output.kind === 'arm_timer') {
      const timer = { id: output.timer, runId: executionId, fireAt: output.fireAt, summary: 'call timeout' };
      const armed = timers.arm(timer);
      scheduler?.schedule(timer);
      performed.push(`${name} arms ${output.timer}${armed ? '' : ' (already armed, ignored)'}`);
    } else if (output.kind === 'cancel_timer') {
      performed.push(
        `${name} cancels ${output.timer}: ${timers.cancel(output.timer) ? 'cancelled' : 'nothing to cancel'}`,
      );
    } else if (output.kind === 'cancel_call') {
      await run(ledger.execute(jobStreamOf(output.key), jobDecider, { kind: 'cancel', at: clock.now() }));
      performed.push(`${name} cancels the job ${output.key}; the remote step keeps running`);
    } else {
      performed.push(`${name} settles ${executionId}: ${output.outcome}`);
    }
  };

  const dispatch = async (executionId: string, crash?: CrashPoint): Promise<void> => {
    const { state: through } = await run(ledger.load(watermarkStreamOf(executionId), watermarkDecider));
    const { state, version } = await loadRun(executionId);
    for (const { position, output } of state.outputs) {
      if (position > through) {
        await perform(executionId, output);
      }
    }
    if (crash === 'after-dispatch') {
      throw new Crash('after dispatching, before advancing the watermark');
    }
    await run(ledger.execute(watermarkStreamOf(executionId), watermarkDecider, version));
  };

  return {
    name,
    submit,
    wake: async (executionIds) => {
      for (const executionId of executionIds) {
        await dispatch(executionId);
        const { state } = await loadRun(executionId);
        const started = state.outputs.find(({ output }) => output.kind === 'start_call')?.output;
        if (state.phase === 'calling' && started?.kind === 'start_call') {
          await ensureJob(executionId, started.key, started.stepMs);
        }
      }
    },
    fireDueTimers: async () => {
      const due = timers.due(clock.now());
      for (const timer of due) {
        await submit(timer.runId, `fired:${timer.id}`, { kind: 'timer_fired', timer: timer.id });
        timers.markFired(timer.id, clock.now(), name);
        performed.push(`${name} fires ${timer.id}`);
      }
      return due.length;
    },
    nextTimerAt: () => timers.earliest(),
    inspect: async (executionId) => {
      const { state, version } = await loadRun(executionId);
      const started = state.outputs.find(({ output }) => output.kind === 'start_call')?.output;
      const job = started?.kind === 'start_call' ? (await loadJob(started.key)).transcript : [];
      const { state: watermark } = await run(ledger.load(watermarkStreamOf(executionId), watermarkDecider));
      return {
        runVersion: version,
        phase: state.phase,
        run: state.transcript,
        outcomes: state.outputs.filter(({ output }) => output.kind === 'settle').length,
        consumedIds: [...state.consumed],
        job,
        watermark,
        timers: timers.database
          .prepare('SELECT id, fire_at, cancelled, fired_at, fired_by FROM timers WHERE run_id = ?')
          .all(executionId),
      };
    },
    effects: () => performed,
    close: async () => {
      for (const stop of running.values()) {
        stop();
      }
      scheduler?.stop();
      timers.close();
      await opened.dispose();
    },
    attachScheduler: (attached) => {
      scheduler = attached;
    },
    timers,
  };
}
