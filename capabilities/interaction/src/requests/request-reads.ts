import { RequestAnsweredSchema } from '@beonauto/definitions';
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

export interface RecordedAnswerFact {
  readonly id: string;
  readonly answer: Schema.Json;
  readonly claimedFor?: string;
  readonly reply?: { readonly id: string; readonly sender: string };
  readonly by: string;
  readonly at: string;
}

const decodeAnswered = Schema.decodeUnknownEffect(
  Schema.NonEmptyArray(
    Schema.Struct({
      id: Schema.String,
      data: RequestAnsweredSchema,
      context: Schema.Struct({ by: Schema.String, at: Schema.String }),
    }),
  ),
);

export function recordedAnswerOf(id: string): Effect.Effect<RecordedAnswerFact, never, BrainReader> {
  return BrainReader.use((reader) =>
    reader.readRecorded(
      { kind: 'run', run: id },
      { order: 'desc', limit: 1, types: ['request_answered'], dataOf: ['request_answered'] },
    ),
  ).pipe(
    Effect.flatMap(({ records }) => decodeAnswered(records)),
    Effect.map(([{ id: answerId, data, context }]): RecordedAnswerFact => {
      const { answer, claimed_for: claimedFor, reply } = data;
      return {
        id: answerId,
        answer,
        ...(claimedFor === undefined ? {} : { claimedFor }),
        ...(reply === undefined ? {} : { reply }),
        by: context.by,
        at: context.at,
      };
    }),
    Effect.orDie,
  );
}
