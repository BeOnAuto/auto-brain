import { SQL } from '@event-driven-io/dumbo';

export interface ContentDialect {
  readonly bytesType: string;
  readonly bytesOfHex: (hex: string) => SQL;
  readonly tablesAmong: (names: readonly string[]) => SQL;
  readonly columnsOf: (table: string) => SQL;
}

export const sqliteContent: ContentDialect = {
  bytesType: 'BLOB',
  bytesOfHex: (hex) => SQL`unhex(${hex})`,
  tablesAmong: (names) =>
    SQL`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (SELECT value FROM json_each(${JSON.stringify(names)}))`,
  columnsOf: (table) => SQL`SELECT name FROM pragma_table_info(${table})`,
};

export const postgresqlContent: ContentDialect = {
  bytesType: 'BYTEA',
  bytesOfHex: (hex) => SQL`decode(${hex}, 'hex')`,
  tablesAmong: (names) => SQL`SELECT relname AS name FROM pg_class
    WHERE relkind IN ('r', 'p') AND relname IN (${SQL.merge(
      names.map((name) => SQL`${name}`),
      ', ',
    )}) AND pg_table_is_visible(oid)`,
  columnsOf: (table) => SQL`SELECT attname AS name FROM pg_attribute
    WHERE attrelid = to_regclass(${table}) AND attnum > 0 AND NOT attisdropped`,
};
