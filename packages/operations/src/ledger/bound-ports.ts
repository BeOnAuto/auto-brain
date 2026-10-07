import { Effect } from 'effect';

import type { BrainAddress } from '../caller/brain-context.ts';
import type { OrgAddress } from '../caller/org-context.ts';
import { InvalidInput } from '../outcome/invalid-input.ts';
import type { BrainProjectionReader, ProjectionReader } from '../projections/run-projection.ts';
import { isCalendarDay } from '../reading/calendar-days.ts';
import { mostRecordsInAPage } from '../reading/page-bounds.ts';
import type {
  InvalidCursorKind,
  RecordedPage,
  RecordedPageRequest,
  RecordedSelection,
} from '../reading/recorded-read.ts';
import type { RunOutcomeWindow } from '../run-outcomes/run-outcomes.ts';
import type {
  BrainRecordedReader,
  BrainRunOutcomesReader,
  RecordedReader,
  RunOutcomesReader,
  StreamReader,
  StreamWriter,
} from './stream-ports.ts';

const streamNameGrammar = /^[A-Za-z0-9_-]{1,64}(?:\/[A-Za-z0-9_-]{1,64})*$/u;

const longestStreamName = 256;

function wellFormed(stream: string): Effect.Effect<string> {
  return stream.length <= longestStreamName && streamNameGrammar.test(stream)
    ? Effect.succeed(stream)
    : Effect.die(new Error(`The stream name ${JSON.stringify(stream)} is malformed`));
}

export function streamPrefixOfOrg({ org }: OrgAddress): string {
  return `org/${org}/`;
}

export function streamPrefixOfBrain({ org, brain }: BrainAddress): string {
  return `brain/${org}/${brain}/`;
}

export function prefixedReader(ledger: StreamReader, prefix: string): StreamReader {
  return {
    load: (stream, decider) =>
      wellFormed(stream).pipe(Effect.flatMap((relative) => ledger.load(`${prefix}${relative}`, decider))),
  };
}

export function prefixedWriter(ledger: StreamWriter, prefix: string): StreamWriter {
  return {
    execute: (stream, decider, command, lineage) =>
      wellFormed(stream).pipe(
        Effect.flatMap((relative) => ledger.execute(`${prefix}${relative}`, decider, command, lineage)),
      ),
  };
}

function wellFormedSelection(selection: RecordedSelection): Effect.Effect<RecordedSelection> {
  if (selection.kind === 'run') {
    return wellFormed(`executions/${selection.execution}`).pipe(Effect.as(selection));
  }
  return selection.kind === 'correlated'
    ? wellFormed(`executions/${selection.correlation}`).pipe(Effect.as(selection))
    : Effect.succeed(selection);
}

function wellFormedPage(page: RecordedPageRequest): Effect.Effect<RecordedPageRequest> {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > mostRecordsInAPage) {
    return Effect.die(new RangeError(`A page holds 1 to ${mostRecordsInAPage} records, not ${page.limit}`));
  }
  return page.since === undefined || Number.isFinite(Date.parse(page.since))
    ? Effect.succeed(page)
    : Effect.die(new RangeError(`The time ${JSON.stringify(page.since)} a page starts from is not a time`));
}

const refusedCursors: Readonly<Record<InvalidCursorKind, InvalidInput>> = {
  malformed: new InvalidInput({
    detail: 'The cursor is malformed',
    issues: [{ detail: 'Expected a next_cursor or the cursor of an event, as a read gives it', pointer: '/cursor' }],
  }),
  of_another_brain: new InvalidInput({
    detail: 'The cursor was not given by a read of this brain',
    issues: [
      { detail: 'Expected a next_cursor or the cursor of an event that a read of this brain gave', pointer: '/cursor' },
    ],
  }),
};

function relativeTo(prefix: string): (page: RecordedPage) => RecordedPage {
  return ({ records, ...paging }) => ({
    records: records.map((record) => ({ ...record, stream: record.stream.slice(prefix.length) })),
    ...paging,
  });
}

export function brainBoundRecordedReader(ledger: RecordedReader, brain: BrainAddress): BrainRecordedReader {
  return {
    readRecorded: (selection, page) =>
      Effect.gen(function* () {
        const checkedSelection = yield* wellFormedSelection(selection);
        const checkedPage = yield* wellFormedPage(page);
        return yield* ledger.readRecorded(brain, checkedSelection, checkedPage);
      }).pipe(
        Effect.map(relativeTo(streamPrefixOfBrain(brain))),
        Effect.mapError(({ kind }: { readonly kind: InvalidCursorKind }) => refusedCursors[kind]),
      ),
  };
}

function wellFormedWindow(window: RunOutcomeWindow): Effect.Effect<RunOutcomeWindow> {
  const { from, to } = window;
  return isCalendarDay(from) && isCalendarDay(to) && from <= to
    ? Effect.succeed(window)
    : Effect.die(new RangeError(`The days from ${JSON.stringify(from)} to ${JSON.stringify(to)} are not a window`));
}

export function brainBoundProjectionReader(ledger: ProjectionReader, brain: BrainAddress): BrainProjectionReader {
  return {
    readProjectedRows: (projection, query) =>
      Number.isSafeInteger(query.limit) && query.limit >= 1
        ? ledger.readProjectedRows(projection, brain, query)
        : Effect.die(new RangeError(`A read of projected rows takes a limit of 1 or more, not ${query.limit}`)),
    countProjectedRows: (projection, where) => ledger.countProjectedRows(projection, brain, where),
  };
}

export function brainBoundRunOutcomesReader(ledger: RunOutcomesReader, brain: BrainAddress): BrainRunOutcomesReader {
  return {
    readRunOutcomes: (window, selection) =>
      wellFormedWindow(window).pipe(Effect.flatMap((checked) => ledger.readRunOutcomes(brain, checked, selection))),
  };
}
