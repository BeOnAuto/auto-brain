import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { createMissingIndexes, type BrainIndex, type IndexExecutor } from './missing-indexes.ts';

function prefixThroughSlashes(count: number): string {
  const end = Array.from({ length: count - 1 }).reduce<string>(
    (found) => `${found} + instr(substr(stream_id, ${found} + 1), '/')`,
    "instr(stream_id, '/')",
  );
  return `substr(stream_id, 1, ${end})`;
}

const brainKeyText = prefixThroughSlashes(3);

export const brainKeyOfStream = SQL.plain(brainKeyText);

export const kindKeyOfStream = SQL.plain(prefixThroughSlashes(4));

export const definitionTypeOfStream = SQL.plain(
  `CASE WHEN substr(stream_id, length(${brainKeyText}) + 1, 6) = 'definitions/' THEN substr(stream_id, length(${brainKeyText}) + 7) END`,
);

export const correlationOfMessage = SQL.plain("json_extract(message_metadata, '$.correlationId')");

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

const brainIndexes: readonly BrainIndex[] = [
  {
    name: 'ledger_messages_by_brain',
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_brain ON emt_messages (${brainKeyOfStream}, global_position)`,
  },
  {
    name: 'ledger_messages_by_brain_and_time',
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_brain_and_time ON emt_messages (${brainKeyOfStream}, created)`,
  },
  {
    name: 'ledger_messages_by_stream',
    create: () =>
      SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_stream ON emt_messages (stream_id, global_position)`,
  },
  {
    name: 'ledger_first_messages_by_kind',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_first_messages_by_kind
      ON emt_messages (${kindKeyOfStream}, global_position) WHERE stream_position = 1`,
  },
  {
    name: 'ledger_messages_by_brain_and_correlation',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_brain_and_correlation
      ON emt_messages (${brainKeyOfStream}, ${correlationOfMessage}, global_position)`,
  },
  {
    name: 'ledger_definition_streams',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_definition_streams
      ON emt_streams (${definitionTypeOfStream}) WHERE ${definitionTypeOfStream} IS NOT NULL`,
  },
];

export async function createSQLiteBrainIndexes(execute: IndexExecutor): Promise<void> {
  const names = JSON.stringify(brainIndexes.map(({ name }) => name));
  const { rows } = await execute.query(
    SQL`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (SELECT value FROM json_each(${names}))`,
  );
  const existing = new Set(Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name));
  await createMissingIndexes(execute, brainIndexes, existing);
}
