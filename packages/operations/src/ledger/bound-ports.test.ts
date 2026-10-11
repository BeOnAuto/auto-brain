import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { streamPrefixOfPlaybook, streamPrefixOfOrg } from '../index.ts';
import { readTallyRows, runTallyRows } from '../projections/tally-rows.ts';
import { runFacts, type RunFact } from '../run-outcomes/run-tallies.ts';
import { acmeAdmin, acmeAlphaReader, globexAdmin } from '../testing/callers.ts';
import { harness, toPlaybook, toOrg } from '../testing/harness.ts';
import { addNote, listNotes } from '../testing/notes.ts';
import { getPlaybookLabel, labelPlaybook, listPlaybookLabels } from '../testing/playbook-labels.ts';
import { putOnShelf, readShelf } from '../testing/shelves.ts';

describe('the ports bound to a call', () => {
  it('prefix every stream with the org or playbook of the call, so each reads and writes only its own', async () => {
    const { dispatcher, ledger, run } = harness();
    const toAcme = toOrg('acme');
    const toAlpha = toPlaybook('acme', 'alpha');
    const toGamma = toPlaybook('globex', 'gamma');

    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })),
    );
    await run(
      dispatcher.dispatchToPlaybook(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })),
    );
    await run(
      dispatcher.dispatchToOrg(labelPlaybook.registration, toAcme(acmeAdmin, { playbook: 'alpha', label: 'Sales' })),
    );
    await run(
      dispatcher.dispatchToOrg(labelPlaybook.registration, toAcme(acmeAdmin, { playbook: 'beta', label: 'Support' })),
    );

    expect(ledger.streamNames()).toEqual([
      'playbook/acme/alpha/notes',
      'playbook/globex/gamma/notes',
      'org/acme/playbook-labels',
    ]);
    expect(await run(dispatcher.dispatchToPlaybook(listNotes.registration, toAlpha(acmeAlphaReader)))).toEqual({
      status: 'succeeded',
      output: { notes: [{ name: 'anvil', text: 'heavy' }] },
    });
    expect(await run(dispatcher.dispatchToPlaybook(listNotes.registration, toGamma(globexAdmin)))).toEqual({
      status: 'succeeded',
      output: { notes: [{ name: 'gear', text: 'round' }] },
    });
    expect(
      await run(
        dispatcher.dispatchToOrg(getPlaybookLabel.registration, toAcme(acmeAlphaReader, { playbook: 'alpha' })),
      ),
    ).toEqual({
      status: 'succeeded',
      output: { playbook: 'alpha', label: 'Sales' },
    });
    expect(await run(dispatcher.dispatchToOrg(listPlaybookLabels.registration, toOrg('globex')(globexAdmin)))).toEqual({
      status: 'succeeded',
      output: { labels: [] },
    });
  });
});

describe('the prefix of an org', () => {
  it('is shared with code that holds the unbound ledger', async () => {
    const { dispatcher, ledger, run } = harness();

    await run(
      dispatcher.dispatchToOrg(
        labelPlaybook.registration,
        toOrg('acme')(acmeAdmin, { playbook: 'alpha', label: 'Sales' }),
      ),
    );

    expect(ledger.streamNames()).toEqual([`${streamPrefixOfOrg({ org: 'acme' })}playbook-labels`]);
  });
});

describe('the prefix of a playbook', () => {
  it('is shared with code that holds the unbound ledger', async () => {
    const { dispatcher, ledger, run } = harness();

    await run(
      dispatcher.dispatchToPlaybook(
        addNote.registration,
        toPlaybook('acme', 'alpha')(acmeAdmin, { name: 'anvil', text: 'x' }),
      ),
    );

    expect(ledger.streamNames()).toEqual([`${streamPrefixOfPlaybook({ org: 'acme', playbook: 'alpha' })}notes`]);
  });
});

const malformedStreams = [
  '../../beta/definitions',
  '',
  'red/',
  'red//blue',
  'a\u0000b',
  'r'.repeat(65),
  Array.from({ length: 5 }, () => 'r'.repeat(60)).join('/'),
];

describe('a stream name a handler gives a bound port', () => {
  it('is one or more segments of letters, digits, _ and -, compared case-sensitively', async () => {
    const { dispatcher, ledger, run } = harness();
    const toAlpha = toPlaybook('acme', 'alpha');

    await run(
      dispatcher.dispatchToPlaybook(putOnShelf.registration, toAlpha(acmeAdmin, { shelf: 'red', item: 'anvil' })),
    );
    await run(
      dispatcher.dispatchToPlaybook(
        putOnShelf.registration,
        toAlpha(acmeAdmin, { shelf: 'Red_1-x/top', item: 'bolt' }),
      ),
    );

    expect(ledger.streamNames()).toEqual([
      'playbook/acme/alpha/shelves/red',
      'playbook/acme/alpha/shelves/Red_1-x/top',
    ]);
    expect(
      await run(dispatcher.dispatchToPlaybook(readShelf.registration, toAlpha(acmeAdmin, { shelf: 'RED' }))),
    ).toEqual({
      status: 'succeeded',
      output: { items: [] },
    });
  });

  it.each(malformedStreams)('fails the call when it names the stream shelves/%j', async (shelf) => {
    const { dispatcher, ledger, reported, run } = harness();
    const toAlpha = toPlaybook('acme', 'alpha');

    const writing = await run(
      dispatcher.dispatchToPlaybook(putOnShelf.registration, toAlpha(acmeAdmin, { shelf, item: 'x' })),
    );
    const reading = await run(dispatcher.dispatchToPlaybook(readShelf.registration, toAlpha(acmeAdmin, { shelf })));

    expect([writing.status, reading.status, ledger.streamNames()]).toEqual(['failed', 'failed', []]);
    expect(reported().map(({ original }) => original)).toEqual([
      new Error(`The stream name ${JSON.stringify(`shelves/${shelf}`)} is malformed`),
      new Error(`The stream name ${JSON.stringify(`shelves/${shelf}`)} is malformed`),
    ]);
  });
});

const toAlpha = toPlaybook('acme', 'alpha');

describe('the read of projected rows, bound to a call', () => {
  it('reads only the playbook of the call, and counts its rows', async () => {
    const { dispatcher, ledger, run } = harness({ projections: [runTallyRows] });
    const began: RunFact = { type: 'run_began', at: '2026-10-01T09:00:00.000Z', fn: 'triage' };
    await Effect.runPromise(ledger.service.execute('playbook/acme/alpha/runs/r1', runFacts, [began]));
    await Effect.runPromise(ledger.service.execute('playbook/acme/beta/runs/r2', runFacts, [began]));

    expect(
      await run(dispatcher.dispatchToPlaybook(readTallyRows.registration, toAlpha(acmeAdmin, { limit: 5 }))),
    ).toEqual({
      status: 'succeeded',
      output: { runs: ['r1'], open: 1 },
    });
  });

  it('fails the call for a limit below one', async () => {
    const { dispatcher, reported, run } = harness({ projections: [runTallyRows] });

    expect(
      await run(dispatcher.dispatchToPlaybook(readTallyRows.registration, toAlpha(acmeAdmin, { limit: 0 }))),
    ).toMatchObject({ status: 'failed' });
    expect(reported().map(({ original }) => String(original))).toEqual([
      'RangeError: A read of projected rows takes a limit of 1 or more, not 0',
    ]);
  });
});
