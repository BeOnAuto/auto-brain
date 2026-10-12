import { playbookOfStreamPrefix, streamKindOf, type PlaybookAddress, type RecordedEvent } from '@beonauto/operations';
import { Effect, Option } from 'effect';

import type { ApplyDefinitionRecord } from '../triggers/definition-records.ts';
import {
  boundTo,
  deliverySweeps,
  type CallConsumer,
  type Consumer,
  type FollowedRecord,
  type RecordConsumer,
} from './consumers.ts';
import { deliveredAll, type Mode } from './delivery-loop.ts';
import { followedEventOf } from './followed-events.ts';
import type { Progress } from './followed-playbooks.ts';
import { relativeRecord } from './playbook-records.ts';
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
  readonly definitionType: string;
  readonly applyDefinitionRecord: ApplyDefinitionRecord;
  readonly unreadable: (playbookKey: string, record: Pick<RecordedEvent, 'id' | 'type'>) => Effect.Effect<void>;
  readonly passedEarly: (playbookKey: string, record: RecordedEvent, sweeps: number) => Effect.Effect<void>;
}

export interface Stepping {
  readonly playbookKey: string;
  readonly gate: RunGate;
  readonly mode: Mode;
  readonly delivers: ReadonlySet<string>;
  readonly wantsMore: () => Effect.Effect<boolean>;
}

export function playbookOfKey(playbookKey: string): PlaybookAddress {
  return Option.getOrThrowWith(
    playbookOfStreamPrefix(playbookKey),
    () => new Error(`The host follows ${playbookKey}, which is not the key of a playbook`),
  );
}

function passedOver(record: RecordedEvent): Progress {
  return { cursor: record.cursor, delivered: null, attempts: 0, waiting: false };
}

function followedOf(
  parts: StepParts,
  playbookKey: string,
  relative: RecordedEvent,
): Effect.Effect<FollowedRecord | null> {
  const event = followedEventOf(relative, parts.definitionType);
  if (event === 'unreadable') {
    return Effect.as(parts.unreadable(playbookKey, relative), null);
  }
  return Effect.succeed(
    event === 'none' ? null : { playbook: playbookOfKey(playbookKey), playbookKey, record: relative, event },
  );
}

function runRecordStep(parts: StepParts, stepping: Stepping, progress: Progress, record: RecordedEvent) {
  const { gate, mode, playbookKey } = stepping;
  const sweeps = mode === 'sweep' ? progress.attempts + 1 : progress.attempts;
  return Effect.flatMap(gate.verdictOn(record, mode === 'sweep' && sweeps >= deliverySweeps), (verdict) => {
    if (verdict === 'held') {
      return Effect.succeed<Step>({ progress: { ...progress, attempts: sweeps, waiting: true }, end: 'waiting' });
    }
    const passed: Step = { progress: passedOver(record) };
    if (verdict === 'passed') {
      return Effect.succeed(passed);
    }
    const noted = verdict === 'overdue' ? parts.passedEarly(playbookKey, record, sweeps) : Effect.void;
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
    const { playbookKey } = stepping;
    const relative = relativeRecord(playbookKey, record);
    const calls = parts.calls
      .filter(({ types }) => types.includes(record.type))
      .map((consumer) => boundTo(consumer, { playbook: playbookOfKey(playbookKey), playbookKey, record: relative }));
    const consumers = [...calls, ...boundOf(parts, yield* followedOf(parts, playbookKey, relative))];
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
  const { playbookKey, delivers } = stepping;
  if (streamKindOf(record.stream.slice(playbookKey.length)) === 'run-logs') {
    return runRecordStep(parts, stepping, progress, record);
  }
  const step: Effect.Effect<Step> = delivers.has(record.type)
    ? deliveredStep(parts, stepping, progress, record)
    : Effect.succeed({ progress: passedOver(record) });
  if (record.stream === `${playbookKey}definitions/${parts.definitionType}`) {
    const readAgain: Effect.Effect<Step> = Effect.succeed({ progress, end: 'more' });
    return Effect.flatMap(parts.applyDefinitionRecord(playbookKey, record), (applied) =>
      applied === 'unreadable'
        ? Effect.as(parts.unreadable(playbookKey, record), { progress: passedOver(record) })
        : Effect.flatMap(stepping.wantsMore(), (more) => (more ? readAgain : step)),
    );
  }
  return step;
}
