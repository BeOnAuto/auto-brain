import { messageIdOf, runStreamOf, type ProjectedRow, type RunProjection, type RunStream } from '@beonauto/operations';

import type { StatementExecutor } from '../event-store.ts';
import {
  inlineRegistrationOf,
  inTurn,
  type InlineProjection,
  type InlineRegistration,
  type StoredMessage,
} from './inline-projection.ts';
import type { ProjectionDialect } from './projection-dialect.ts';
import { rowIn, rowsWrite } from './projection-statements.ts';

export interface ProjectionKeeping {
  readonly dialect: ProjectionDialect;
  readonly projection: RunProjection;
}

export interface ReplayedMessage {
  readonly stream: string;
  readonly data: unknown;
  readonly position: number;
}

async function keptAfter(
  { dialect, projection }: ProjectionKeeping,
  execute: StatementExecutor,
  run: RunStream,
  { data, id, position }: StoredMessage,
): Promise<void> {
  const row = projection.rowAfter(await rowIn(execute, dialect, projection, run), dialect.appendedData(data), {
    id,
    position,
  });
  if (row !== undefined) {
    await execute.command(rowsWrite(dialect, projection, [{ run, row }]));
  }
}

function keepingProjection(keeping: ProjectionKeeping): InlineProjection {
  return {
    types: keeping.projection.types,
    handle: (messages, execute) =>
      inTurn(messages, async (message: StoredMessage) => {
        const run = runStreamOf(message.stream);
        if (run !== undefined) {
          await keptAfter(keeping, execute, run, message);
        }
      }),
  };
}

export function replayedRow(
  { dialect, projection }: ProjectionKeeping,
  messages: readonly ReplayedMessage[],
): ProjectedRow | undefined {
  let row: ProjectedRow | undefined;
  for (const { stream, data, position } of messages) {
    row = projection.rowAfter(row, dialect.filledData(data), { id: messageIdOf(stream, position), position }) ?? row;
  }
  return row;
}

export function projectionRegistrations(
  dialect: ProjectionDialect,
  projections: readonly RunProjection[],
): readonly InlineRegistration[] {
  return projections.map((projection) => inlineRegistrationOf(keepingProjection({ dialect, projection })));
}
