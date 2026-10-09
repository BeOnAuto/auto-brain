import { BrainReader } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { openRequestsName } from './open-requests.ts';
import { requestRowOf, type OpenRequestRow } from './request-rows.ts';

export function openRequestRowIn(id: string): Effect.Effect<OpenRequestRow | undefined, never, BrainReader> {
  return BrainReader.use((reader) =>
    reader.readProjectedRows(openRequestsName, {
      where: [{ column: 'row_key', equals: id }],
      orderBy: [],
      order: 'asc',
      limit: 1,
    }),
  ).pipe(Effect.map(([kept]) => requestRowOf(kept?.row)));
}

const decodeFirst = Schema.decodeUnknownSync(Schema.NonEmptyArray(Schema.Struct({ correlationId: Schema.String })));

export function correlationOfRun(id: string): Effect.Effect<string, never, BrainReader> {
  return BrainReader.use((reader) =>
    reader.readRecorded({ kind: 'run', run: id }, { order: 'asc', limit: 1, dataOf: [] }),
  ).pipe(
    Effect.map(({ records }) => decodeFirst(records)[0].correlationId),
    Effect.orDie,
  );
}
