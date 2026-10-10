import { definitionChangeOf } from '@beonauto/definitions';
import type { RecordedStream } from '@beonauto/ledger';
import type { RecordedEvent } from '@beonauto/operations';
import { Effect } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import type { FilterStops } from '../filtering/filter-matching.ts';
import { triggersActivated, triggersRemoved } from './trigger-rows.ts';

export type DefinitionRecord = Pick<RecordedEvent, 'id' | 'type' | 'data' | 'context'>;

type DefinitionApplied = 'applied' | 'unreadable';

export type ApplyDefinitionRecord = (brainKey: string, record: DefinitionRecord) => Effect.Effect<DefinitionApplied>;

export function definitionRecordsOn(database: HostDatabase, stops: FilterStops): ApplyDefinitionRecord {
  return (brainKey, record) => {
    const { id } = record;
    const change = definitionChangeOf(record);
    if (change.kind === 'activated') {
      const { name: workflow, version, triggers, at } = change;
      const activation = { workflow, version, triggers, activatedBy: id, activatedAt: Date.parse(at) };
      stops.activated(brainKey, workflow, version);
      return Effect.as(triggersActivated(database, brainKey, activation), 'applied');
    }
    if (change.kind === 'deactivated') {
      stops.retired(brainKey, change.name);
      return Effect.as(triggersRemoved(database, brainKey, change.name), 'applied');
    }
    return Effect.succeed(change.kind === 'unreadable' ? 'unreadable' : 'applied');
  };
}

export function definitionRecordsIn({ messages }: RecordedStream): readonly DefinitionRecord[] {
  return messages.map(({ type, data, context, lineage }) => ({ id: lineage.id, type, data, context }));
}
