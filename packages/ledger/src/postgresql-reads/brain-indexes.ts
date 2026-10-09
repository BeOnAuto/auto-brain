import { SQL } from '@event-driven-io/dumbo';
import { Schema } from 'effect';

import { createMissingIndexes, type BrainIndex, type IndexExecutor } from '../recorded/missing-indexes.ts';

export const brainKeyOfStream = "substring(stream_id FROM '^(?:[^/]*/){3}')";

export const kindKeyOfStream = "substring(stream_id FROM '^(?:[^/]*/){4}')";

export const correlationOfMessage = "(message_metadata ->> 'correlationId')";

export const definitionTypeOfStream = "substring(stream_id FROM '^(?:[^/]*/){3}definitions/([^/]+)$')";

const NameRows = Schema.Array(Schema.Struct({ name: Schema.String }));

const brainKey = SQL.plain(brainKeyOfStream);

const brainIndexes: readonly BrainIndex[] = [
  {
    name: 'ledger_messages_by_brain',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_brain
      ON emt_messages ((${brainKey}), transaction_id, global_position)`,
  },
  {
    name: 'ledger_messages_by_brain_and_time',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_brain_and_time
      ON emt_messages ((${brainKey}), created, transaction_id, global_position)`,
  },
  {
    name: 'ledger_messages_by_stream',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_stream
      ON emt_messages (stream_id, transaction_id, global_position)`,
  },
  {
    name: 'ledger_first_messages_by_kind',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_first_messages_by_kind
      ON emt_messages ((${SQL.plain(kindKeyOfStream)}), stream_position, transaction_id, global_position)`,
  },
  {
    name: 'ledger_messages_by_brain_and_correlation',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_messages_by_brain_and_correlation
      ON emt_messages ((${brainKey}), ${SQL.plain(correlationOfMessage)}, transaction_id, global_position)`,
  },
  {
    name: 'ledger_definition_streams',
    create: () => SQL`CREATE INDEX IF NOT EXISTS ledger_definition_streams
      ON emt_streams ((${SQL.plain(definitionTypeOfStream)})) WHERE (${SQL.plain(definitionTypeOfStream)}) IS NOT NULL`,
  },
];

export async function createPostgreSQLBrainIndexes({ execute }: { readonly execute: IndexExecutor }): Promise<void> {
  const names = SQL.merge(
    brainIndexes.map(({ name }) => SQL`${name}`),
    ', ',
  );
  const { rows } = await execute.query(
    SQL`SELECT relname AS name FROM pg_class
      WHERE relkind IN ('i', 'I') AND relname IN (${names}) AND pg_table_is_visible(oid)`,
  );
  const existing = new Set(Schema.decodeUnknownSync(NameRows)(rows).map(({ name }) => name));
  const created = await createMissingIndexes(execute, brainIndexes, existing);
  if (created > 0) {
    await execute.command(SQL`ANALYZE emt_messages, emt_streams`);
  }
}
