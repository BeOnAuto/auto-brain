import {
  brainStreamOf,
  messageIdOf,
  rowKeyOf,
  setsAdvancedColumns,
  type KeyedProjection,
  type ProjectedRow,
} from '@beonauto/operations';

import type { StatementExecutor } from '../event-store.ts';
import {
  inlineRegistrationOf,
  inTurn,
  type InlineProjection,
  type InlineRegistration,
  type StoredMessage,
} from './inline-projection.ts';
import type { ProjectionDialect } from './projection-dialect.ts';
import { rowIn, rowsWrite, type RowPlace } from './projection-statements.ts';

export interface ProjectionKeeping {
  readonly dialect: ProjectionDialect;
  readonly projection: KeyedProjection;
}

export interface ReplayedMessage {
  readonly stream: string;
  readonly data: unknown;
  readonly position: number;
}

async function keptAfter(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  place: RowPlace,
  { type, data, id, position }: StoredMessage,
): Promise<void> {
  const stored = await rowIn(execute, dialect, projection, place);
  const row = projection.rowAfter(stored, data, { id, position });
  if (row !== undefined) {
    const written =
      stored === undefined || setsAdvancedColumns(projection, type) ? 'with_advanced' : 'without_advanced';
    await execute.command(rowsWrite(dialect, projection, [{ ...place, row }], written));
  }
}

function placeOf(projection: KeyedProjection, { stream, data }: StoredMessage): RowPlace | undefined {
  const named = brainStreamOf(stream);
  const key = named === undefined ? undefined : rowKeyOf(projection, data, named);
  return named === undefined || key === undefined ? undefined : { brainKey: named.brainKey, key };
}

function keepingProjection(keeping: ProjectionKeeping): InlineProjection {
  return {
    types: keeping.projection.types,
    handle: (messages, execute) =>
      inTurn(messages, async (message: StoredMessage) => {
        const decoded = { ...message, data: keeping.dialect.appendedData(message.data) };
        const place = placeOf(keeping.projection, decoded);
        if (place !== undefined) {
          await keptAfter(keeping, execute, place, decoded);
        }
      }),
  };
}

export function replayedRow(
  { dialect, projection }: ProjectionKeeping,
  messages: readonly ReplayedMessage[],
  from?: ProjectedRow,
): ProjectedRow | undefined {
  let row = from;
  for (const { stream, data, position } of messages) {
    row = projection.rowAfter(row, dialect.filledData(data), { id: messageIdOf(stream, position), position }) ?? row;
  }
  return row;
}

export function projectionRegistrations(
  dialect: ProjectionDialect,
  projections: readonly KeyedProjection[],
): readonly InlineRegistration[] {
  return projections.map((projection) => inlineRegistrationOf(keepingProjection({ dialect, projection })));
}
