import { describe, expect, it } from 'vitest';

import { getBrainLabel, labelBrain, listBrainLabels } from './testing/brain-labels.ts';
import { acmeAdmin, acmeAlphaReader, globexAdmin } from './testing/callers.ts';
import { harness, toBrain, toOrg } from './testing/harness.ts';
import { addNote, listNotes } from './testing/notes.ts';

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
