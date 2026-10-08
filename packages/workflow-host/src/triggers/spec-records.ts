import type { RecordedStream } from '@beonauto/ledger';
import type { RecordedEvent } from '@beonauto/operations';
import { specChangeOf } from '@beonauto/specs';
import { Effect, Option, Schema } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { triggersActivated, triggersRemoved } from './trigger-rows.ts';

export type SpecRecord = Pick<RecordedEvent, 'id' | 'type' | 'data'>;

export type SpecApplied = 'applied' | 'unreadable';

export type ApplySpecRecord = (brainKey: string, record: SpecRecord) => Effect.Effect<SpecApplied>;

const decodeType = Schema.decodeUnknownOption(Schema.Struct({ type: Schema.String }));

export function specRecordsOn(database: HostDatabase): ApplySpecRecord {
  return (brainKey, { id, data }) => {
    const change = specChangeOf(data);
    if (change.kind === 'activated') {
      const { name: workflow, version, triggers, at } = change;
      const activation = { workflow, version, triggers, activatedBy: id, activatedAt: Date.parse(at) };
      return Effect.as(triggersActivated(database, brainKey, activation), 'applied');
    }
    if (change.kind === 'deactivated') {
      return Effect.as(triggersRemoved(database, brainKey, change.name), 'applied');
    }
    return Effect.succeed(change.kind === 'unreadable' ? 'unreadable' : 'applied');
  };
}

export function specRecordsIn({ events, lineages }: RecordedStream): readonly SpecRecord[] {
  return lineages.map(({ id }, index) => {
    const data = events[index];
    const type = Option.getOrElse(
      Option.map(decodeType(data), (typed) => typed.type),
      () => 'unknown',
    );
    return { id, type, data };
  });
}
