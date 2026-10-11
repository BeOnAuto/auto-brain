import {
  InvalidCursor,
  streamPrefixOfPlaybook,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedReader,
} from '@beonauto/operations';
import { Effect, Result } from 'effect';

import type { RecordedStore, StoredPage, StoredPageRequest } from '../event-store.ts';
import { cursorOf, pointOf, type CursorPoint } from './cursor.ts';

function storedRequestOf(
  { cursor, ...page }: RecordedPageRequest,
  playbookKey: string,
  pointLength: number,
): Effect.Effect<StoredPageRequest, InvalidCursor> {
  if (cursor === undefined) {
    return Effect.succeed(page);
  }
  return Result.match(pointOf(cursor, playbookKey, pointLength), {
    onFailure: (kind) => Effect.fail(new InvalidCursor({ kind })),
    onSuccess: ({ point, within }: CursorPoint) =>
      Effect.succeed(within ? { ...page, at: point } : { ...page, after: point }),
  });
}

function recordedPageOf(playbookKey: string): (stored: StoredPage) => RecordedPage {
  return ({ records, resumeAfter, lastExamined }) => ({
    records: records.map(({ point, id, causationId, correlationId, stream, version, type, data, recordedAt }) => ({
      id,
      cursor: cursorOf(playbookKey, point),
      causationId,
      correlationId,
      stream,
      version,
      type,
      data,
      recordedAt,
    })),
    hasMore: resumeAfter !== undefined,
    nextCursor: resumeAfter === undefined ? null : cursorOf(playbookKey, resumeAfter),
    lastExamined:
      lastExamined === undefined
        ? null
        : { cursor: cursorOf(playbookKey, lastExamined.point), recordedAt: lastExamined.recordedAt },
  });
}

export function recordedReaderOf(store: RecordedStore): RecordedReader['readRecorded'] {
  return (playbook, selection, page) => {
    const playbookKey = streamPrefixOfPlaybook(playbook);
    return storedRequestOf(page, playbookKey, store.pointLength).pipe(
      Effect.flatMap((request) => Effect.promise(() => store.readRecorded(playbookKey, selection, request))),
      Effect.map(recordedPageOf(playbookKey)),
    );
  };
}
