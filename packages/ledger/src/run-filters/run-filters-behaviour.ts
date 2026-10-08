import type { Decider, RecordedPage, RecordedPageRequest, RecordedSelection } from '@beonauto/operations';
import { Effect, Result, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { details, inAlpha, reading, type AnyLedger, type LedgerMaker } from '../testing/happenings.ts';

const RunFactSchema = Schema.Struct({
  type: Schema.String,
  primitive: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  detail: Schema.optionalKey(Schema.Json),
});

type RunFact = typeof RunFactSchema.Type;

const runFacts: Decider<null, readonly RunFact[], RunFact> = {
  initialState: null,
  evolve: () => null,
  decide: (facts) => Result.succeed(facts),
  eventSchema: RunFactSchema,
};

const runsOfTheReport = Array.from({ length: 28 }, (_, index) => index);

function startOfTheReport(index: number): RunFact {
  return {
    type: 'execution_started',
    primitive: index % 4 === 0 ? 'orchestration' : 'inference',
    name: index % 4 === 1 ? 'qualify-enquiry' : 'summary',
  };
}

function endingOfTheReport(index: number): RunFact {
  return { type: index % 9 === 2 ? 'execution_rejected' : 'execution_succeeded' };
}

function recordedRun(ledger: AnyLedger, run: string, facts: readonly RunFact[]): Effect.Effect<unknown, unknown> {
  return ledger.execute(inAlpha(`executions/${run}`), runFacts, facts);
}

async function twentyEightRuns(aLedger: LedgerMaker): Promise<AnyLedger> {
  const ledger = await aLedger();
  await Effect.runPromise(
    Effect.forEach(
      runsOfTheReport,
      (index) => recordedRun(ledger, `run-${index}`, [startOfTheReport(index), endingOfTheReport(index)]),
      { discard: true },
    ),
  );
  return ledger;
}

type RunsOnAPage = readonly [runs: readonly string[], hasMore: boolean];

function runsOn({ records, hasMore }: RecordedPage): RunsOnAPage {
  const runsListed = new Set(records.map(({ stream }) => stream.slice(inAlpha('executions/').length)));
  return [[...runsListed], hasMore];
}

async function everyPageOfRuns(
  ledger: AnyLedger,
  selection: RecordedSelection,
  page: RecordedPageRequest,
): Promise<readonly RunsOnAPage[]> {
  const read = await reading(ledger, selection, page);
  return read.nextCursor === null
    ? [runsOn(read)]
    : [runsOn(read), ...(await everyPageOfRuns(ledger, selection, { ...page, cursor: read.nextCursor }))];
}

const runsOfOrchestration: RecordedSelection = { kind: 'executions', primitive: 'orchestration' };

function theRunsOfOnePrimitive(aLedger: LedgerMaker): void {
  it(
    'fill every page with the runs of the primitive asked for, five then two, and have no more after the last',
    { timeout: 60_000 },
    async () => {
      const ledger = await twentyEightRuns(aLedger);

      const pages = await everyPageOfRuns(ledger, runsOfOrchestration, { order: 'desc', limit: 5 });

      expect(pages).toEqual([
        [['run-24', 'run-20', 'run-16', 'run-12', 'run-8'], true],
        [['run-4', 'run-0'], false],
      ]);
    },
  );
}

function theRunsOfOneName(aLedger: LedgerMaker): void {
  it('page through the seven runs of the name asked for, two at a time', { timeout: 60_000 }, async () => {
    const ledger = await twentyEightRuns(aLedger);

    const pages = await everyPageOfRuns(
      ledger,
      { kind: 'executions', name: 'qualify-enquiry' },
      { order: 'desc', limit: 2 },
    );

    expect(pages).toEqual([
      [['run-25', 'run-21'], true],
      [['run-17', 'run-13'], true],
      [['run-9', 'run-5'], true],
      [['run-1'], false],
    ]);
  });
}

function theRejectedRuns(aLedger: LedgerMaker): void {
  it(
    'answer a rejected run one at a time behind newer runs that succeeded, of any definition or of one',
    { timeout: 60_000 },
    async () => {
      const ledger = await twentyEightRuns(aLedger);
      const rejectedOneAtATime = { order: 'desc', limit: 1, types: ['execution_rejected'] } as const;

      const pages = await Promise.all([
        everyPageOfRuns(ledger, { kind: 'executions' }, rejectedOneAtATime),
        everyPageOfRuns(ledger, runsOfOrchestration, rejectedOneAtATime),
      ]);

      expect(pages).toEqual([
        [
          [['run-20'], true],
          [['run-11'], true],
          [['run-2'], false],
        ],
        [[['run-20'], false]],
      ]);
    },
  );
}

const awkwardText = {
  nul: 'a NUL \u0000 inside',
  unpaired: 'half a pair \uD800 alone',
  escapedBackslash: String.raw`\u0000 is six characters`,
  beforeNul: '\\\u0000',
  emoji: '😀',
  escapedNul: String.raw`a\u0000b`,
};

function theDefinitionOfAnAwkwardRun(aLedger: LedgerMaker): void {
  it('is read at the top of the first message alone, exactly as recorded, whatever else the message holds', async () => {
    const ledger = await aLedger();
    const awkward = { primitive: 'orchestration', name: 'qualify-enquiry', text: awkwardText };
    const start = { type: 'execution_started', primitive: 'inference', name: 'summary', detail: awkward };
    const namedAwkwardly = { ...start, name: awkwardText.escapedNul, detail: 'named awkwardly' };
    await Effect.runPromise(recordedRun(ledger, 'awkward', [start]));
    await Effect.runPromise(recordedRun(ledger, 'named-awkwardly', [namedAwkwardly]));
    const newest = { order: 'desc', limit: 10 } as const;

    const pages = await Promise.all([
      reading(ledger, { kind: 'executions', primitive: 'inference', name: 'summary' }, newest),
      reading(ledger, runsOfOrchestration, newest),
      reading(ledger, { kind: 'executions', name: 'qualify-enquiry' }, newest),
      reading(ledger, { kind: 'executions', name: awkwardText.escapedNul }, newest),
      reading(ledger, { kind: 'executions', name: 'a' }, newest),
    ]);

    expect(pages.map((page) => details(page))).toEqual([[awkward], [], [], ['named awkwardly'], []]);
  });
}

export function runFiltersBehaviour(aLedger: LedgerMaker): void {
  describe('the runs of one definition', () => {
    theRunsOfOnePrimitive(aLedger);
    theRunsOfOneName(aLedger);
    theRejectedRuns(aLedger);
    theDefinitionOfAnAwkwardRun(aLedger);
  });
}
