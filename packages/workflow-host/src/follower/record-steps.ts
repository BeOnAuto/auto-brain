import { streamKindOf, type RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';

import type { ApplySpecRecord } from '../reactions/spec-records.ts';
import { relativeRecord } from './brain-records.ts';
import type { Consumer, FollowedRecord } from './consumers.ts';
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
  readonly consumers: readonly Consumer[];
  readonly primitive: string;
  readonly applySpecRecord: ApplySpecRecord;
  readonly unreadable: (brainKey: string, record: RecordedEvent) => Effect.Effect<void>;
}

export interface Stepping {
  readonly brainKey: string;
  readonly gate: RunGate;
  readonly mode: Mode;
  readonly withData: boolean;
}

export function brainOfKey(brainKey: string): { readonly org: string; readonly brain: string } {
  const [, org = '', brain = ''] = brainKey.split('/');
  return { org, brain };
}

function passedOver(record: RecordedEvent): Progress {
  return { cursor: record.cursor, delivered: null, attempts: 0, waiting: false };
}

function followedOf(parts: StepParts, brainKey: string, record: RecordedEvent): Effect.Effect<FollowedRecord | null> {
  const relative = relativeRecord(brainKey, record);
  const event = followedEventOf(relative, parts.primitive);
  if (event === 'unreadable') {
    return Effect.as(parts.unreadable(brainKey, relative), null);
  }
  return Effect.succeed(event === 'none' ? null : { brain: brainOfKey(brainKey), brainKey, record: relative, event });
}

function runRecordStep({ gate, withData }: Stepping, progress: Progress, record: RecordedEvent): Effect.Effect<Step> {
  return Effect.map(gate.verdictOn(record), (verdict): Step => {
    if (verdict === 'held') {
      return { progress: { ...progress, waiting: true }, end: 'waiting' };
    }
    return verdict === 'listened' && !withData
      ? { progress: passedOver(record), end: 'more' }
      : { progress: passedOver(record) };
  });
}

function deliveredStep(parts: StepParts, stepping: Stepping, progress: Progress, record: RecordedEvent) {
  return Effect.gen(function* () {
    const followed = yield* followedOf(parts, stepping.brainKey, record);
    if (followed === null) {
      return { progress: passedOver(record) };
    }
    const { made, ...delivered } = yield* deliveredAll(parts.consumers, followed, progress, stepping.mode);
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
  const { brainKey, withData } = stepping;
  if (streamKindOf(record.stream.slice(brainKey.length)) === 'runs') {
    return runRecordStep(stepping, progress, record);
  }
  if (record.stream === `${brainKey}specs/${parts.primitive}`) {
    const afterSpec: Effect.Effect<Step> = withData
      ? deliveredStep(parts, stepping, progress, record)
      : Effect.succeed({ progress: passedOver(record), end: 'more' });
    return Effect.andThen(parts.applySpecRecord(brainKey, record.data), afterSpec);
  }
  return withData ? deliveredStep(parts, stepping, progress, record) : Effect.succeed({ progress: passedOver(record) });
}
