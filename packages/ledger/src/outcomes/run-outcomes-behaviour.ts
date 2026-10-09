import type {
  BrainAddress,
  Ledger,
  RunOutcomeGroup,
  RunOutcomeMapping,
  RunOutcomeSelection,
  RunOutcomeWindow,
} from '@beonauto/operations';
import { runFacts, runTallies, type RunFact } from '@beonauto/operations/testing';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

type AnyLedger = Ledger['Service'];

export type LedgerKeeping = (runOutcomes?: RunOutcomeMapping) => Promise<AnyLedger>;

const alpha: BrainAddress = { org: 'acme', brain: 'alpha' };

const october: RunOutcomeWindow = { from: '2026-10-01', to: '2026-10-31' };

export function noting(ledger: AnyLedger, stream: string, ...facts: readonly RunFact[]): Promise<unknown> {
  return Effect.runPromise(ledger.execute(stream, runFacts, facts));
}

export function began(fn: string, at = '2026-10-01T09:00:00.000Z'): RunFact {
  return { type: 'run_began', at, fn };
}

export function ended(
  status: 'succeeded' | 'failed' | 'rejected',
  ms: number | null,
  tokens: number | null = null,
): RunFact {
  return { type: 'run_ended', status, ms, tokens };
}

function inOrder(groups: readonly RunOutcomeGroup[]): readonly RunOutcomeGroup[] {
  return groups
    .map((group): RunOutcomeGroup => ({ ...group, durations: group.durations.toSorted((left, right) => left - right) }))
    .toSorted((left, right) =>
      `${left.day} ${left.name} ${left.status}`.localeCompare(`${right.day} ${right.name} ${right.status}`),
    );
}

export async function reading(
  ledger: AnyLedger,
  window: RunOutcomeWindow = october,
  selection: RunOutcomeSelection = {},
  brain: BrainAddress = alpha,
): Promise<readonly RunOutcomeGroup[]> {
  return inOrder(await Effect.runPromise(ledger.readRunOutcomes(brain, window, selection)));
}

export function runsOf(groups: readonly RunOutcomeGroup[]): readonly string[] {
  return groups.map(({ day, name, status, runs }) => `${day} ${name} ${status} ${runs}`);
}

export async function fourRuns(ledger: AnyLedger): Promise<void> {
  await noting(ledger, 'brain/acme/alpha/runs/r1', began('triage'), ended('succeeded', 120, 40));
  await noting(ledger, 'brain/acme/alpha/runs/r2', began('triage'));
  await noting(ledger, 'brain/acme/alpha/runs/r2', ended('succeeded', 80, 2));
  await noting(ledger, 'brain/acme/alpha/runs/r3', began('triage'), ended('rejected', null));
  await noting(ledger, 'brain/acme/alpha/runs/r4', began('draft', '2026-10-02T23:59:59.999Z'));
}

export const fourRunsKept: readonly RunOutcomeGroup[] = [
  {
    day: '2026-10-01',
    definitionType: 'tally',
    name: 'triage',
    status: 'rejected',
    runs: 1,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    durations: [],
  },
  {
    day: '2026-10-01',
    definitionType: 'tally',
    name: 'triage',
    status: 'succeeded',
    runs: 2,
    inputTokens: 42,
    outputTokens: 42,
    cachedTokens: 42,
    durations: [80, 120],
  },
  {
    day: '2026-10-02',
    definitionType: 'tally',
    name: 'draft',
    status: 'started',
    runs: 1,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    durations: [],
  },
];

function theRowOfEachRun(aLedger: LedgerKeeping): void {
  describe('the outcomes of runs', () => {
    it('are one row per run, kept through every append, grouped by day, function and status', async () => {
      const ledger = await aLedger(runTallies);
      await fourRuns(ledger);

      expect(await reading(ledger)).toEqual(fourRunsKept);
    });

    it('keep to the days of the window, the selection, and the brain matched exactly', async () => {
      const ledger = await aLedger(runTallies);
      await noting(ledger, 'brain/acme/alpha/runs/r1', began('triage', '2026-09-30T23:59:59.999Z'));
      await noting(ledger, 'brain/acme/alpha/runs/r2', began('triage', '2026-10-01T00:00:00.000Z'));
      await noting(ledger, 'brain/acme/alpha/runs/r3', began('draft', '2026-10-01T00:00:00.000Z'));
      await Promise.all(
        ['brain/acme/alpha2/runs/r4', 'brain/acme/Alpha/runs/r5', 'brain/acme/alph_/runs/r6'].map((stream) =>
          noting(ledger, stream, began('triage', '2026-10-01T00:00:00.000Z')),
        ),
      );

      const pages = await Promise.all([
        reading(ledger, { from: '2026-10-01', to: '2026-10-01' }),
        reading(ledger, { from: '2026-09-30', to: '2026-09-30' }),
        reading(ledger, october, { name: 'draft' }),
        reading(ledger, october, { definitionType: 'other' }),
        reading(ledger, october, { definitionType: 'tally', name: 'triage' }),
        reading(ledger, october, {}, { org: 'acme', brain: 'alph_' }),
      ]);

      expect(pages.map((groups) => runsOf(groups))).toEqual([
        ['2026-10-01 draft started 1', '2026-10-01 triage started 1'],
        ['2026-09-30 triage started 1'],
        ['2026-10-01 draft started 1'],
        [],
        ['2026-10-01 triage started 1'],
        ['2026-10-01 triage started 1'],
      ]);
    });

    it('leave out other streams, a stream nested under a run, other types, and what the mapping keeps nothing of', async () => {
      const ledger = await aLedger(runTallies);
      await noting(ledger, 'brain/acme/alpha/run-logs/r1', began('triage'));
      await noting(ledger, 'brain/acme/alpha/runs/r2/nested', began('triage'));
      await noting(ledger, 'brain/acme/alpha/runs/r3', ended('failed', 5), { type: 'run_noted' });

      expect(await reading(ledger)).toEqual([]);
    });
  });
}

export function runOutcomesBehaviour(aLedger: LedgerKeeping): void {
  theRowOfEachRun(aLedger);
}
