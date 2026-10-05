import {
  boundedPage,
  mostRunsExaminedInAPage,
  type Examined,
  type RecordedOrder,
  type RecordedSelection,
} from '@beonauto/operations';

import type { RecordedPoint, RecordedStore, StoredPage, StoredPageRequest } from '../event-store.ts';

export interface RecordHead {
  readonly point: RecordedPoint;
  readonly stream: string;
  readonly type: string;
  readonly recordedAt: string;
}

export interface ExaminedItem extends Examined {
  readonly point: RecordedPoint;
  readonly heads: readonly RecordHead[];
}

export interface ExaminationScope {
  readonly brainKey: string;
  readonly order: RecordedOrder;
  readonly examineAtMost: number;
  readonly answerAtMost: number;
  readonly types?: readonly string[];
  readonly after?: RecordedPoint;
  readonly from?: RecordedPoint;
}

export interface RecordedStatements {
  readonly firstPointSince: (brainKey: string, since: string) => Promise<RecordedPoint | undefined>;
  readonly examineRecords: (
    streams: readonly string[] | undefined,
    scope: ExaminationScope,
  ) => Promise<readonly ExaminedItem[]>;
  readonly examineRuns: (scope: ExaminationScope) => Promise<readonly ExaminedItem[]>;
  readonly dataAt: (points: readonly RecordedPoint[]) => Promise<ReadonlyMap<string, unknown>>;
}

export function pointKey(point: RecordedPoint): string {
  return point.join(':');
}

function scopeOf(
  brainKey: string,
  selection: RecordedSelection,
  { order, limit, types, after }: StoredPageRequest,
): ExaminationScope {
  const filteringRuns = selection.kind === 'executions' && types !== undefined;
  return {
    brainKey,
    order,
    examineAtMost: filteringRuns ? mostRunsExaminedInAPage : limit,
    answerAtMost: filteringRuns ? limit + 2 : limit + 1,
    ...(types === undefined ? {} : { types }),
    ...(after === undefined ? {} : { after }),
  };
}

function examine(
  statements: RecordedStatements,
  selection: RecordedSelection,
  scope: ExaminationScope,
): Promise<readonly ExaminedItem[]> {
  if (selection.kind === 'executions') {
    return statements.examineRuns(scope);
  }
  const { brainKey } = scope;
  return statements.examineRecords(
    selection.kind === 'run'
      ? [`${brainKey}executions/${selection.execution}`, `${brainKey}runs/${selection.execution}`]
      : undefined,
    scope,
  );
}

async function pageWithin(
  statements: RecordedStatements,
  selection: RecordedSelection,
  limit: number,
  scope: ExaminationScope,
): Promise<StoredPage> {
  const examined = await examine(statements, selection, scope);
  const { delivered, resumeAfter } = boundedPage(examined, limit, scope.examineAtMost);
  const heads = delivered.flatMap((item) => item.heads);
  const data =
    heads.length === 0 ? new Map<string, unknown>() : await statements.dataAt(heads.map(({ point }) => point));
  const records = heads.map(({ point, stream, type, recordedAt }) => ({
    point,
    stream,
    type,
    recordedAt,
    data: data.get(pointKey(point)),
  }));
  return resumeAfter === undefined ? { records } : { records, resumeAfter: resumeAfter.point };
}

export function recordedReadingOver(statements: RecordedStatements): RecordedStore['readRecorded'] {
  return async (brainKey, selection, page) => {
    const scope = scopeOf(brainKey, selection, page);
    if (page.since === undefined) {
      return pageWithin(statements, selection, page.limit, scope);
    }
    const from = await statements.firstPointSince(brainKey, page.since);
    return from === undefined ? { records: [] } : pageWithin(statements, selection, page.limit, { ...scope, from });
  };
}
