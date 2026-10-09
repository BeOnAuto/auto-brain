import { definitionChangeOf } from '@beonauto/definitions';
import type { RecordedStream } from '@beonauto/ledger';
import type { RecordedEvent } from '@beonauto/operations';
import { Effect, Option, Schema } from 'effect';

import type { HostDatabase } from '../database/host-database.ts';
import { triggersActivated, triggersRemoved } from './trigger-rows.ts';

export type DefinitionRecord = Pick<RecordedEvent, 'id' | 'type' | 'data'>;

type DefinitionApplied = 'applied' | 'unreadable';

export type ApplyDefinitionRecord = (brainKey: string, record: DefinitionRecord) => Effect.Effect<DefinitionApplied>;

const decodeType = Schema.decodeUnknownOption(Schema.Struct({ type: Schema.String }));

export function definitionRecordsOn(database: HostDatabase): ApplyDefinitionRecord {
  return (brainKey, { id, data }) => {
    const change = definitionChangeOf(data);
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

export function definitionRecordsIn({ events, lineages }: RecordedStream): readonly DefinitionRecord[] {
  return lineages.map(({ id }, index) => {
    const data = events[index];
    const type = Option.getOrElse(
      Option.map(decodeType(data), (typed) => typed.type),
      () => 'unknown',
    );
    return { id, type, data };
  });
}
