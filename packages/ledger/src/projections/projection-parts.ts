import type { ProjectionReader, RunOutcomeMapping, RunProjection } from '@beonauto/operations';

import type { StatementExecutor } from '../event-store.ts';
import { keptProjections } from '../outcomes/run-outcome-projection.ts';
import type { InlineRegistration } from './inline-projection.ts';
import type { ProjectionDialect } from './projection-dialect.ts';
import { preparedProjections, type InTransaction } from './projection-fill.ts';
import { projectionRegistrations } from './projection-keeping.ts';
import { projectionReader, type ReadQuery } from './projection-reads.ts';

export interface KeptTables {
  readonly runOutcomes?: RunOutcomeMapping | undefined;
  readonly projections?: readonly RunProjection[] | undefined;
}

export interface ProjectionParts {
  readonly registrations: readonly InlineRegistration[];
  readonly prepare: (execute: StatementExecutor, inTransaction: InTransaction) => Promise<void>;
  readonly readerOn: (query: ReadQuery) => ProjectionReader;
}

export function projectionPartsOf(
  dialect: ProjectionDialect,
  { runOutcomes, projections = [] }: KeptTables,
): ProjectionParts {
  const kept = keptProjections(runOutcomes, projections);
  return {
    registrations: projectionRegistrations(dialect, kept),
    prepare: (execute, inTransaction) =>
      preparedProjections(
        kept.map((projection) => ({ dialect, projection })),
        execute,
        inTransaction,
      ),
    readerOn: (query) => projectionReader(dialect, kept, query),
  };
}
