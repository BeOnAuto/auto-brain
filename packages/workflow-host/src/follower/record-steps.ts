import { streamKindOf, type RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ApplyDefinitionRecord } from '../triggers/definition-records.ts';
import { relativeRecord } from './brain-records.ts';
import {
  boundTo,
  deliverySweeps,
  type CallConsumer,
  type Consumer,
  type FollowedRecord,
  type RecordConsumer,
} from './consumers.ts';
import { deliveredAll, type Mode } from './delivery-loop.ts';
import type { Progress } from './followed-brains.ts';
import { followedEventOf } from './followed-events.ts';
import type { RunGate } from './run-gate.ts';

export type PassEnd = 'caught_up' | 'more' | 'waiting';

export interface Step {
  readonly progress: Progress;
  readonly end?: PassEnd;
  readonly delivered?: boolean;
}

export interface StepParts {
  readonly consumers: readonly RecordConsumer[];
  readonly registered: readonly Consumer[];
  readonly calls: readonly CallConsumer[];
  readonly type: string;
  readonly applyDefinitionRecord: ApplyDefinitionRecord;
  readonly unreadable: (brainKey: string, record: Pick<RecordedEvent, 'id' | 'type'>) => Effect.Effect<void>;
  readonly passedEarly: (brainKey: string, record: RecordedEvent, sweeps: number) => Effect.Effect<void>;
}

export interface Stepping {
  readonly brainKey: string;
  readonly gate: RunGate;
  readonly mode: Mode;
  readonly delivers: ReadonlySet<string>;
  readonly wantsMore: () => Effect.Effect<boolean>;
}

export function brainOfKey(brainKey: string): { readonly org: string; readonly brain: string } {
  const [, org = '', brain = ''] = brainKey.split('/');
  return { org, brain };
}

function passedOver(record: RecordedEvent): Progress {
  return { cursor: record.cursor, delivered: null, attempts: 0, waiting: false };
}

function followedOf(parts: StepParts, brainKey: string, relative: RecordedEvent): Effect.Effect<FollowedRecord | null> {
  const event = followedEventOf(relative, parts.type);
  if (event === 'unreadable') {
    return Effect.as(parts.unreadable(brainKey, relative), null);
  }
  return Effect.succeed(event === 'none' ? null : { brain: brainOfKey(brainKey), brainKey, record: relative, event });
}

function runRecordStep(parts: StepParts, stepping: Stepping, progress: Progress, record: RecordedEvent) {
  const { gate, mode, brainKey } = stepping;
  const sweeps = mode === 'sweep' ? progress.attempts + 1 : progress.attempts;
  return Effect.flatMap(gate.verdictOn(record, mode === 'sweep' && sweeps >= deliverySweeps), (verdict) => {
    if (verdict === 'held') {
      return Effect.succeed<Step>({ progress: { ...progress, attempts: sweeps, waiting: true }, end: 'waiting' });
    }
    const passed: Step = { progress: passedOver(record) };
    if (verdict === 'passed') {
      return Effect.succeed(passed);
    }
    const noted = verdict === 'overdue' ? parts.passedEarly(brainKey, record, sweeps) : Effect.void;
    const ended = Effect.map(stepping.wantsMore(), (more): Step => (more ? { ...passed, end: 'more' } : passed));
    return Effect.andThen(noted, ended);
  });
}

function boundOf(parts: StepParts, followed: FollowedRecord | null) {
  if (followed === null) {
    return [];
  }
  const wanting = parts.registered.filter(({ types }) => types.includes(followed.event.event.type));
  return [...parts.consumers, ...wanting].map((consumer) => boundTo(consumer, followed));
}

function deliveredStep(parts: StepParts, stepping: Stepping, progress: Progress, record: RecordedEvent) {
  return Effect.gen(function* () {
    const { brainKey } = stepping;
    const relative = relativeRecord(brainKey, record);
    const calls = parts.calls
      .filter(({ types }) => types.includes(record.type))
      .map((consumer) => boundTo(consumer, { brain: brainOfKey(brainKey), brainKey, record: relative }));
    const consumers = [...calls, ...boundOf(parts, yield* followedOf(parts, brainKey, relative))];
    if (consumers.length === 0) {
      return { progress: passedOver(record) };
    }
    const { made, ...delivered } = yield* deliveredAll(consumers, progress, stepping.mode);
    return delivered.end === undefined
      ? { progress: passedOver(record), delivered: made }
      : { ...delivered, delivered: made };
  });
}

export function stepOf(
  parts: StepParts,
  stepping: Stepping,
  progress: Progress,
  record: RecordedEvent,
): Effect.Effect<Step> {
  const { brainKey, delivers } = stepping;
  if (streamKindOf(record.stream.slice(brainKey.length)) === 'run-logs') {
    return runRecordStep(parts, stepping, progress, record);
  }
  const step: Effect.Effect<Step> = delivers.has(record.type)
    ? deliveredStep(parts, stepping, progress, record)
    : Effect.succeed({ progress: passedOver(record) });
  if (record.stream === `${brainKey}definitions/${parts.type}`) {
    const readAgain: Effect.Effect<Step> = Effect.succeed({ progress, end: 'more' });
    return Effect.flatMap(parts.applyDefinitionRecord(brainKey, record), (applied) =>
      applied === 'unreadable'
        ? Effect.as(parts.unreadable(brainKey, record), { progress: passedOver(record) })
        : Effect.flatMap(stepping.wantsMore(), (more) => (more ? readAgain : step)),
    );
  }
  return step;
}
