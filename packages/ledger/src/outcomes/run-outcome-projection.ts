import { runStreamOf, type RunOutcome, type RunOutcomeMapping, type RunStream } from '@beonauto/operations';

import type { StatementExecutor } from '../event-store.ts';
import {
  inlineRegistrationOf,
  inTurn,
  type InlineProjection,
  type InlineRegistration,
  type StoredMessage,
} from './inline-projection.ts';
import { rowIn, rowWrite, type RunOutcomeStatements } from './run-outcome-statements.ts';

export interface RunOutcomeKeeping {
  readonly statements: RunOutcomeStatements;
  readonly mapping: RunOutcomeMapping;
}

async function keptAfter(
  { statements, mapping }: RunOutcomeKeeping,
  execute: StatementExecutor,
  run: RunStream,
  event: unknown,
): Promise<void> {
  const row = mapping.rowAfter(await rowIn(execute, statements, run), event);
  if (row !== undefined) {
    await execute.command(rowWrite(run, row));
  }
}

export function runOutcomeProjection(keeping: RunOutcomeKeeping): InlineProjection {
  return {
    types: keeping.mapping.types,
    handle: (messages, execute) =>
      inTurn(messages, async ({ stream, data }: StoredMessage) => {
        const run = runStreamOf(stream);
        if (run !== undefined) {
          await keptAfter(keeping, execute, run, keeping.statements.appendedData(data));
        }
      }),
  };
}

export function replayedRow(
  { statements, mapping }: RunOutcomeKeeping,
  messages: readonly { readonly type: string; readonly data: unknown }[],
): RunOutcome | undefined {
  let row: RunOutcome | undefined;
  for (const { type, data } of messages) {
    row = mapping.types.includes(type) ? (mapping.rowAfter(row, statements.filledData(data)) ?? row) : row;
  }
  return row;
}

export function runOutcomeRegistrations(
  statements: RunOutcomeStatements,
  mapping: RunOutcomeMapping | undefined,
): readonly InlineRegistration[] {
  return mapping === undefined ? [] : [inlineRegistrationOf(runOutcomeProjection({ statements, mapping }))];
}
