import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { type RunOutcomeWindow } from '../index.ts';
import { readRunTallies, runFacts, runTallies, type RunFact } from '../run-outcomes/run-tallies.ts';
import { acmeAdmin, globexAdmin } from '../testing/callers.ts';
import { harness, toPlaybook } from '../testing/harness.ts';
import { addNote, readNoteHistory } from '../testing/notes.ts';
import { putOnShelf } from '../testing/shelves.ts';

const toAlpha = toPlaybook('acme', 'alpha');

const toGamma = toPlaybook('globex', 'gamma');

describe('the read of what a playbook recorded, bound to a call', () => {
  it('reads only the playbook of the call, and names its streams relative to the playbook', async () => {
    const { dispatcher, run } = harness();
    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })),
    );
    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })),
    );
    await run(
      dispatcher.dispatchToPlaybook(putOnShelf.registration, toAlpha(acmeAdmin, { shelf: 'red', item: 'bolt' })),
    );

    const whole = await run(
      dispatcher.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 10 })),
    );
    const first = await run(
      dispatcher.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 1 })),
    );

    expect(whole).toMatchObject({
      status: 'succeeded',
      output: { streams: ['notes', 'shelves/red'], next_cursor: null },
    });
    expect(first).toMatchObject({ status: 'succeeded', output: { streams: ['notes'] } });
    expect(first).not.toMatchObject({ output: { next_cursor: null } });
  });

  it('reads the streams of one run', async () => {
    const { dispatcher, run } = harness();
    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })),
    );

    expect(
      await run(
        dispatcher.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 10, run: 'run-1' })),
      ),
    ).toEqual({ status: 'succeeded', output: { streams: [], ids: [], next_cursor: null } });
  });
});

describe('the read of what one run caused, bound to a call', () => {
  it('reads what the run and the runs it caused recorded, by their correlation', async () => {
    const { dispatcher, run } = harness();
    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })),
    );

    expect(
      await run(
        dispatcher.dispatchToPlaybook(
          readNoteHistory.registration,
          toAlpha(acmeAdmin, { limit: 10, correlation: 'run-1' }),
        ),
      ),
    ).toEqual({ status: 'succeeded', output: { streams: [], ids: [], next_cursor: null } });
  });
});

describe('a cursor given to the read bound to a call', () => {
  it('is refused as invalid input at /cursor, saying whether it is malformed or of another playbook', async () => {
    const { dispatcher, ledger, run } = harness();
    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })),
    );
    const { records } = await Effect.runPromise(
      ledger.service.readRecorded(
        { org: 'globex', playbook: 'gamma' },
        { kind: 'everything' },
        { order: 'asc', limit: 1 },
      ),
    );
    const reading = (cursor: string) =>
      run(dispatcher.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 10, cursor })));

    const refusals = await Promise.all(
      [...records.map(({ cursor }) => cursor), 'not-a-cursor'].map((cursor) => reading(cursor)),
    );

    expect(refusals).toEqual([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The cursor was not given by a read of this playbook',
        issues: [
          {
            detail: 'Expected a next_cursor or the cursor of an event that a read of this playbook gave',
            pointer: '/cursor',
          },
        ],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The cursor is malformed',
        issues: [
          { detail: 'Expected a next_cursor or the cursor of an event, as a read gives it', pointer: '/cursor' },
        ],
      },
    ]);
  });
});

describe('a page the read bound to a call cannot hold', () => {
  it.each([
    [{ limit: 0 }, 'RangeError: A page holds 1 to 100 records, not 0'],
    [{ limit: 101 }, 'RangeError: A page holds 1 to 100 records, not 101'],
    [{ limit: 10, since: 'yesterday' }, 'RangeError: The time "yesterday" a page starts from is not a time'],
    [{ limit: 10, run: 'a/../b' }, 'Error: The stream name "runs/a/../b" is malformed'],
    [{ limit: 10, correlation: 'a/../b' }, 'Error: The stream name "runs/a/../b" is malformed'],
  ] as const)('fails the call, %j', async (input, defect) => {
    const { dispatcher, reported, run } = harness();

    expect(
      await run(dispatcher.dispatchToPlaybook(readNoteHistory.registration, toAlpha(acmeAdmin, input))),
    ).toMatchObject({ status: 'failed' });
    expect(reported().map(({ original }) => String(original))).toEqual([defect]);
  });
});

const unreadableWindows: readonly (readonly [RunOutcomeWindow, string])[] = [
  [{ from: '2026-10-02', to: '2026-10-01' }, 'RangeError: The days from "2026-10-02" to "2026-10-01" are not a window'],
  [{ from: '2026-02-30', to: '2026-03-01' }, 'RangeError: The days from "2026-02-30" to "2026-03-01" are not a window'],
  [{ from: '2026-10-01', to: 'today' }, 'RangeError: The days from "2026-10-01" to "today" are not a window'],
];

describe('the read of the outcomes of runs, bound to a call', () => {
  it('reads only the playbook of the call', async () => {
    const { dispatcher, ledger, run } = harness({ runOutcomes: runTallies });
    const began: RunFact = { type: 'run_began', at: '2026-10-01T09:00:00.000Z', fn: 'triage' };
    await Effect.runPromise(ledger.service.execute('playbook/acme/alpha/runs/r1', runFacts, [began]));
    await Effect.runPromise(ledger.service.execute('playbook/globex/gamma/runs/r2', runFacts, [began]));
    const window = { from: '2026-10-01', to: '2026-10-01' };

    const read = await run(dispatcher.dispatchToPlaybook(readRunTallies.registration, toAlpha(acmeAdmin, window)));
    const named = await run(
      dispatcher.dispatchToPlaybook(readRunTallies.registration, toAlpha(acmeAdmin, { ...window, name: 'draft' })),
    );

    expect(read).toMatchObject({
      status: 'succeeded',
      output: { groups: [{ type: 'tally', name: 'triage', runs: 1 }] },
    });
    expect(named).toEqual({ status: 'succeeded', output: { groups: [] } });
  });

  it.each(unreadableWindows)('fails the call for a window it cannot read, %j', async (window, defect) => {
    const { dispatcher, reported, run } = harness({ runOutcomes: runTallies });

    expect(
      await run(dispatcher.dispatchToPlaybook(readRunTallies.registration, toAlpha(acmeAdmin, window))),
    ).toMatchObject({ status: 'failed' });
    expect(reported().map(({ original }) => String(original))).toEqual([defect]);
  });
});
