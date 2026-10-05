import { Effect, Option, Schema } from 'effect';

import {
  InvalidCursor,
  boundedPage,
  mostRunsExaminedInAPage,
  streamPrefixOfBrain,
  type BrainAddress,
  type RecordedEvent,
  type RecordedPage,
  type RecordedPageRequest,
  type RecordedReader,
  type RecordedSelection,
} from '../index.ts';

export interface MemoryRecord {
  readonly position: number;
  readonly stream: string;
  readonly streamPosition: number;
  readonly type: string;
  readonly data: unknown;
  readonly recordedAt: string;
}

interface ExaminedRun {
  readonly examined: number;
  readonly wanted: boolean;
  readonly size: number;
  readonly position: number;
  readonly heads: readonly MemoryRecord[];
}

const CursorSchema = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(
    Schema.fromJsonString(Schema.Tuple([Schema.String, Schema.String.check(Schema.isPattern(/^[1-9]\d{0,14}$/u))])),
  ),
);

const decodeCursor = Schema.decodeUnknownOption(CursorSchema);

const encodeCursor = Schema.encodeSync(CursorSchema);

const utf8 = new TextEncoder();

function brainKeyOf(stream: string): string | undefined {
  const segments = stream.split('/');
  return segments.length > 3 ? `${segments.slice(0, 3).join('/')}/` : undefined;
}

function positionAfter({ cursor, order }: RecordedPageRequest, key: string): Effect.Effect<number, InvalidCursor> {
  if (cursor === undefined) {
    return Effect.succeed(order === 'asc' ? 0 : Number.POSITIVE_INFINITY);
  }
  return Option.match(
    Option.filter(decodeCursor(cursor), ([cursorKey]) => cursorKey === key),
    { onNone: () => Effect.fail(new InvalidCursor()), onSome: ([, position]) => Effect.succeed(Number(position)) },
  );
}

function sizeOf({ data }: MemoryRecord): number {
  return utf8.encode(JSON.stringify(data)).byteLength;
}

function inSelection(key: string, selection: RecordedSelection): (record: MemoryRecord) => boolean {
  if (selection.kind === 'run') {
    const streams = new Set([`${key}executions/${selection.execution}`, `${key}runs/${selection.execution}`]);
    return ({ stream }) => streams.has(stream);
  }
  if (selection.kind === 'executions') {
    return ({ stream, streamPosition }) => streamPosition === 1 && stream.startsWith(`${key}executions/`);
  }
  return () => true;
}

function byTimeThenPosition(left: MemoryRecord, right: MemoryRecord): number {
  const apart = Date.parse(left.recordedAt) - Date.parse(right.recordedAt);
  return apart === 0 ? left.position - right.position : apart;
}

function firstSince(inBrain: readonly MemoryRecord[], since: string | undefined): number | undefined {
  if (since === undefined) {
    return 0;
  }
  const from = Date.parse(since);
  return inBrain
    .filter(({ recordedAt }) => Date.parse(recordedAt) >= from)
    .toSorted(byTimeThenPosition)
    .at(0)?.position;
}

function examinedRecords(
  candidates: readonly MemoryRecord[],
  { limit, types }: RecordedPageRequest,
): readonly ExaminedRun[] {
  return candidates.slice(0, limit + 1).map((record, index) => {
    const wanted = types === undefined || types.includes(record.type);
    return {
      examined: index + 1,
      wanted,
      size: wanted ? sizeOf(record) : 0,
      position: record.position,
      heads: [record],
    };
  });
}

function examinedRuns(
  log: readonly MemoryRecord[],
  candidates: readonly MemoryRecord[],
  { types }: RecordedPageRequest,
): readonly ExaminedRun[] {
  return candidates.slice(0, mostRunsExaminedInAPage + 1).map((first, index) => {
    const latest = log.reduce((last, record) => (record.stream === first.stream ? record : last), first);
    const heads = latest === first ? [first] : [first, latest];
    const wanted = types === undefined || types.includes(latest.type);
    const size = heads.reduce((total, head) => total + sizeOf(head), 0);
    return { examined: index + 1, wanted, size: wanted ? size : 0, position: first.position, heads };
  });
}

function recordedOf(key: string, { position, stream, type, data, recordedAt }: MemoryRecord): RecordedEvent {
  return { id: encodeCursor([key, String(position)]), stream, type, data, recordedAt };
}

function pageOf(
  log: readonly MemoryRecord[],
  key: string,
  selection: RecordedSelection,
  page: RecordedPageRequest,
): (after: number) => RecordedPage {
  return (after) => {
    const inBrain = log.filter(({ stream }) => brainKeyOf(stream) === key);
    const from = firstSince(inBrain, page.since) ?? Number.POSITIVE_INFINITY;
    const inOrder = page.order === 'asc' ? inBrain : inBrain.toReversed();
    const candidates = inOrder.filter(
      (record) =>
        inSelection(key, selection)(record) &&
        record.position >= from &&
        (page.order === 'asc' ? record.position > after : record.position < after),
    );
    const examined =
      selection.kind === 'executions' ? examinedRuns(log, candidates, page) : examinedRecords(candidates, page);
    const cap = selection.kind === 'executions' ? mostRunsExaminedInAPage : page.limit;
    const { delivered, resumeAfter } = boundedPage(examined, page.limit, cap);
    const nextCursor = resumeAfter === undefined ? null : encodeCursor([key, String(resumeAfter.position)]);
    return {
      records: delivered.flatMap(({ heads }) => heads.map((head) => recordedOf(key, head))),
      hasMore: nextCursor !== null,
      nextCursor,
    };
  };
}

export function memoryRecordedReader(log: readonly MemoryRecord[]): RecordedReader['readRecorded'] {
  return (brain: BrainAddress, selection, page) =>
    Effect.suspend(() => {
      const key = streamPrefixOfBrain(brain);
      return positionAfter(page, key).pipe(Effect.map(pageOf(log, key, selection, page)));
    });
}
