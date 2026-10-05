import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { streamPrefixOfBrain, streamPrefixOfOrg } from '../index.ts';
import { getBrainLabel, labelBrain, listBrainLabels } from '../testing/brain-labels.ts';
import { acmeAdmin, acmeAlphaReader, globexAdmin } from '../testing/callers.ts';
import { harness, toBrain, toOrg } from '../testing/harness.ts';
import { addNote, listNotes, readNoteHistory } from '../testing/notes.ts';
import { putOnShelf, readShelf } from '../testing/shelves.ts';

describe('the ports bound to a call', () => {
  it('prefix every stream with the org or brain of the call, so each reads and writes only its own', async () => {
    const { dispatcher, ledger, run } = harness();
    const toAcme = toOrg('acme');
    const toAlpha = toBrain('acme', 'alpha');
    const toGamma = toBrain('globex', 'gamma');

    await run(dispatcher.dispatchToBrain(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));
    await run(dispatcher.dispatchToBrain(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })));
    await run(dispatcher.dispatchToOrg(labelBrain.registration, toAcme(acmeAdmin, { brain: 'alpha', label: 'Sales' })));
    await run(
      dispatcher.dispatchToOrg(labelBrain.registration, toAcme(acmeAdmin, { brain: 'beta', label: 'Support' })),
    );

    expect(ledger.streamNames()).toEqual([
      'brain/acme/alpha/notes',
      'brain/globex/gamma/notes',
      'org/acme/brain-labels',
    ]);
    expect(await run(dispatcher.dispatchToBrain(listNotes.registration, toAlpha(acmeAlphaReader)))).toEqual({
      status: 'succeeded',
      output: { notes: [{ name: 'anvil', text: 'heavy' }] },
    });
    expect(await run(dispatcher.dispatchToBrain(listNotes.registration, toGamma(globexAdmin)))).toEqual({
      status: 'succeeded',
      output: { notes: [{ name: 'gear', text: 'round' }] },
    });
    expect(
      await run(dispatcher.dispatchToOrg(getBrainLabel.registration, toAcme(acmeAlphaReader, { brain: 'alpha' }))),
    ).toEqual({
      status: 'succeeded',
      output: { brain: 'alpha', label: 'Sales' },
    });
    expect(await run(dispatcher.dispatchToOrg(listBrainLabels.registration, toOrg('globex')(globexAdmin)))).toEqual({
      status: 'succeeded',
      output: { labels: [] },
    });
  });

  it('share the prefix of an org with code that holds the unbound ledger', async () => {
    const { dispatcher, ledger, run } = harness();

    await run(
      dispatcher.dispatchToOrg(labelBrain.registration, toOrg('acme')(acmeAdmin, { brain: 'alpha', label: 'Sales' })),
    );

    expect(ledger.streamNames()).toEqual([`${streamPrefixOfOrg({ org: 'acme' })}brain-labels`]);
  });
});

describe('the prefix of a brain', () => {
  it('is shared with code that holds the unbound ledger', async () => {
    const { dispatcher, ledger, run } = harness();

    await run(
      dispatcher.dispatchToBrain(
        addNote.registration,
        toBrain('acme', 'alpha')(acmeAdmin, { name: 'anvil', text: 'x' }),
      ),
    );

    expect(ledger.streamNames()).toEqual([`${streamPrefixOfBrain({ org: 'acme', brain: 'alpha' })}notes`]);
  });
});

const malformedStreams = [
  '../../beta/specs',
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
    const toAlpha = toBrain('acme', 'alpha');

    await run(dispatcher.dispatchToBrain(putOnShelf.registration, toAlpha(acmeAdmin, { shelf: 'red', item: 'anvil' })));
    await run(
      dispatcher.dispatchToBrain(putOnShelf.registration, toAlpha(acmeAdmin, { shelf: 'Red_1-x/top', item: 'bolt' })),
    );

    expect(ledger.streamNames()).toEqual(['brain/acme/alpha/shelves/red', 'brain/acme/alpha/shelves/Red_1-x/top']);
    expect(await run(dispatcher.dispatchToBrain(readShelf.registration, toAlpha(acmeAdmin, { shelf: 'RED' })))).toEqual(
      {
        status: 'succeeded',
        output: { items: [] },
      },
    );
  });

  it.each(malformedStreams)('fails the call when it names the stream shelves/%j', async (shelf) => {
    const { dispatcher, ledger, reported, run } = harness();
    const toAlpha = toBrain('acme', 'alpha');

    const writing = await run(
      dispatcher.dispatchToBrain(putOnShelf.registration, toAlpha(acmeAdmin, { shelf, item: 'x' })),
    );
    const reading = await run(dispatcher.dispatchToBrain(readShelf.registration, toAlpha(acmeAdmin, { shelf })));

    expect([writing.status, reading.status, ledger.streamNames()]).toEqual(['failed', 'failed', []]);
    expect(reported().map(({ original }) => original)).toEqual([
      new Error(`The stream name ${JSON.stringify(`shelves/${shelf}`)} is malformed`),
      new Error(`The stream name ${JSON.stringify(`shelves/${shelf}`)} is malformed`),
    ]);
  });
});

const toAlpha = toBrain('acme', 'alpha');

const toGamma = toBrain('globex', 'gamma');

describe('the read of what a brain recorded, bound to a call', () => {
  it('reads only the brain of the call, and names its streams relative to the brain', async () => {
    const { dispatcher, run } = harness();
    await run(dispatcher.dispatchToBrain(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));
    await run(dispatcher.dispatchToBrain(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })));
    await run(dispatcher.dispatchToBrain(putOnShelf.registration, toAlpha(acmeAdmin, { shelf: 'red', item: 'bolt' })));

    const whole = await run(
      dispatcher.dispatchToBrain(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 10 })),
    );
    const first = await run(dispatcher.dispatchToBrain(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 1 })));

    expect(whole).toMatchObject({
      status: 'succeeded',
      output: { streams: ['notes', 'shelves/red'], next_cursor: null },
    });
    expect(first).toMatchObject({ status: 'succeeded', output: { streams: ['notes'] } });
    expect(first).not.toMatchObject({ output: { next_cursor: null } });
  });

  it('reads the streams of one run', async () => {
    const { dispatcher, run } = harness();
    await run(dispatcher.dispatchToBrain(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));

    expect(
      await run(
        dispatcher.dispatchToBrain(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 10, execution: 'run-1' })),
      ),
    ).toEqual({ status: 'succeeded', output: { streams: [], ids: [], next_cursor: null } });
  });
});

describe('a cursor given to the read bound to a call', () => {
  it('is refused as invalid input at /cursor, saying whether it is malformed or of another brain', async () => {
    const { dispatcher, ledger, run } = harness();
    await run(dispatcher.dispatchToBrain(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })));
    const { records } = await Effect.runPromise(
      ledger.service.readRecorded(
        { org: 'globex', brain: 'gamma' },
        { kind: 'everything' },
        { order: 'asc', limit: 1 },
      ),
    );
    const reading = (cursor: string) =>
      run(dispatcher.dispatchToBrain(readNoteHistory.registration, toAlpha(acmeAdmin, { limit: 10, cursor })));

    const refusals = await Promise.all(
      [...records.map(({ id }) => id), 'not-a-cursor'].map((cursor) => reading(cursor)),
    );

    expect(refusals).toEqual([
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The cursor was not given by a read of this brain',
        issues: [{ detail: 'Expected a next_cursor or an id that a read of this brain gave', pointer: '/cursor' }],
      },
      {
        status: 'rejected',
        reason: 'invalid_input',
        detail: 'The cursor is malformed',
        issues: [{ detail: 'Expected a next_cursor or an id, as a read gives it', pointer: '/cursor' }],
      },
    ]);
  });
});

describe('a page the read bound to a call cannot hold', () => {
  it.each([
    [{ limit: 0 }, 'RangeError: A page holds 1 to 100 records, not 0'],
    [{ limit: 101 }, 'RangeError: A page holds 1 to 100 records, not 101'],
    [{ limit: 10, since: 'yesterday' }, 'RangeError: The time "yesterday" a page starts from is not a time'],
    [{ limit: 10, execution: 'a/../b' }, 'Error: The stream name "executions/a/../b" is malformed'],
  ] as const)('fails the call, %j', async (input, defect) => {
    const { dispatcher, reported, run } = harness();

    expect(
      await run(dispatcher.dispatchToBrain(readNoteHistory.registration, toAlpha(acmeAdmin, input))),
    ).toMatchObject({ status: 'failed' });
    expect(reported().map(({ original }) => String(original))).toEqual([defect]);
  });
});
