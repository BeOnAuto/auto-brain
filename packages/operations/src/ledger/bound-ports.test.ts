import { describe, expect, it } from 'vitest';

import { getBrainLabel, labelBrain, listBrainLabels } from '../testing/brain-labels.ts';
import { acmeAdmin, acmeAlphaReader, globexAdmin } from '../testing/callers.ts';
import { harness, toBrain, toOrg } from '../testing/harness.ts';
import { addNote, listNotes } from '../testing/notes.ts';
import { putOnShelf, readShelf } from '../testing/shelves.ts';

describe('the ports bound to a call', () => {
  it('prefix every stream with the org or brain of the call, so each reads and writes only its own', async () => {
    const { dispatcher, ledger, run } = harness();
    const toAcme = toOrg('acme');
    const toAlpha = toBrain('acme', 'alpha');
    const toGamma = toBrain('globex', 'gamma');

    await run(dispatcher.inBrain(addNote.registration, toAlpha(acmeAdmin, { name: 'anvil', text: 'heavy' })));
    await run(dispatcher.inBrain(addNote.registration, toGamma(globexAdmin, { name: 'gear', text: 'round' })));
    await run(dispatcher.inOrg(labelBrain.registration, toAcme(acmeAdmin, { brain: 'alpha', label: 'Sales' })));
    await run(dispatcher.inOrg(labelBrain.registration, toAcme(acmeAdmin, { brain: 'beta', label: 'Support' })));

    expect(ledger.streamNames()).toEqual([
      'brain/acme/alpha/notes',
      'brain/globex/gamma/notes',
      'org/acme/brain-labels',
    ]);
    expect(await run(dispatcher.inBrain(listNotes.registration, toAlpha(acmeAlphaReader)))).toEqual({
      status: 'done',
      output: { notes: [{ name: 'anvil', text: 'heavy' }] },
    });
    expect(await run(dispatcher.inBrain(listNotes.registration, toGamma(globexAdmin)))).toEqual({
      status: 'done',
      output: { notes: [{ name: 'gear', text: 'round' }] },
    });
    expect(
      await run(dispatcher.inOrg(getBrainLabel.registration, toAcme(acmeAlphaReader, { brain: 'alpha' }))),
    ).toEqual({
      status: 'done',
      output: { brain: 'alpha', label: 'Sales' },
    });
    expect(await run(dispatcher.inOrg(listBrainLabels.registration, toOrg('globex')(globexAdmin)))).toEqual({
      status: 'done',
      output: { labels: [] },
    });
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

    await run(dispatcher.inBrain(putOnShelf.registration, toAlpha(acmeAdmin, { shelf: 'red', item: 'anvil' })));
    await run(dispatcher.inBrain(putOnShelf.registration, toAlpha(acmeAdmin, { shelf: 'Red_1-x/top', item: 'bolt' })));

    expect(ledger.streamNames()).toEqual(['brain/acme/alpha/shelves/red', 'brain/acme/alpha/shelves/Red_1-x/top']);
    expect(await run(dispatcher.inBrain(readShelf.registration, toAlpha(acmeAdmin, { shelf: 'RED' })))).toEqual({
      status: 'done',
      output: { items: [] },
    });
  });

  it.each(malformedStreams)('faults the call when it names the stream shelves/%j', async (shelf) => {
    const { dispatcher, ledger, reported, run } = harness();
    const toAlpha = toBrain('acme', 'alpha');

    const writing = await run(dispatcher.inBrain(putOnShelf.registration, toAlpha(acmeAdmin, { shelf, item: 'x' })));
    const reading = await run(dispatcher.inBrain(readShelf.registration, toAlpha(acmeAdmin, { shelf })));

    expect([writing.status, reading.status, ledger.streamNames()]).toEqual(['faulted', 'faulted', []]);
    expect(reported().map(({ original }) => original)).toEqual([
      new Error(`The stream name ${JSON.stringify(`shelves/${shelf}`)} is malformed`),
      new Error(`The stream name ${JSON.stringify(`shelves/${shelf}`)} is malformed`),
    ]);
  });
});
