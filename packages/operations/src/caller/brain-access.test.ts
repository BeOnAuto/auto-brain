import { describe, expect, it } from 'vitest';

import { canAccessBrain, type CallerIdentity } from '../index.ts';
import { getBrainLabel, labelBrain, listBrainLabels, relabelBrain } from '../testing/brain-labels.ts';
import { acmeAdmin, acmeAlphaReader } from '../testing/callers.ts';
import { harness, toBrain, toOrg } from '../testing/harness.ts';
import { getNote } from '../testing/notes.ts';

const toAcme = toOrg('acme');

const alphaWriter: CallerIdentity = { ...acmeAlphaReader, id: 'acme-alpha-writer', permissions: ['org:write'] };

const accessDenied = { status: 'rejected', reason: 'forbidden', detail: 'The caller may not access this brain' };

describe('the brain an org operation targets', () => {
  it('is its input field named brain, wherever that field arrives from', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(
        dispatcher.dispatchToOrg(relabelBrain.registration, toAcme(alphaWriter, { brain: 'beta', label: 'x' })),
      ),
    ).toEqual(accessDenied);
    expect(
      await run(dispatcher.dispatchToOrg(labelBrain.registration, toAcme(alphaWriter, { brain: 'beta', label: 'x' }))),
    ).toEqual(accessDenied);
    expect(
      await run(
        dispatcher.dispatchToOrg(relabelBrain.registration, toAcme(alphaWriter, { brain: 'alpha', label: 'x' })),
      ),
    ).toEqual({ status: 'succeeded', output: { brain: 'alpha', label: 'x' } });
  });

  it('is accessible only to a caller whose list holds it, whatever the field carries', async () => {
    const { dispatcher, run } = harness();
    const asking = (input: unknown) =>
      run(dispatcher.dispatchToOrg(getBrainLabel.registration, toAcme(acmeAlphaReader, input)));

    expect([await asking({ brain: 'beta' }), await asking({ brain: 7 }), await asking({})]).toEqual([
      accessDenied,
      accessDenied,
      accessDenied,
    ]);
    expect(await asking({ brain: 'alpha' })).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'The brain alpha has no label',
    });
  });

  it('is recorded on the registration, and absent for an operation without a brain field', async () => {
    const { dispatcher, run } = harness();

    expect([relabelBrain, labelBrain, listBrainLabels].map(({ registration }) => registration.targetsBrain)).toEqual([
      true,
      true,
      false,
    ]);
    expect(await run(dispatcher.dispatchToOrg(listBrainLabels.registration, toAcme(acmeAlphaReader)))).toEqual({
      status: 'succeeded',
      output: { labels: [] },
    });
  });
});

describe('the brains a caller may access', () => {
  it('are every brain only for the star, and otherwise exactly the brains listed', async () => {
    const { dispatcher, run } = harness();
    const sloppy = { ...acmeAlphaReader };
    Reflect.set(sloppy, 'brains', 'alphabet-beta');

    expect(await run(dispatcher.dispatchToBrain(getNote.registration, toBrain('acme', 'alpha')(sloppy)))).toEqual(
      accessDenied,
    );
    expect(await run(dispatcher.dispatchToBrain(getNote.registration, toBrain('acme', 'beta')(sloppy)))).toEqual(
      accessDenied,
    );
    expect(
      await run(
        dispatcher.dispatchToBrain(getNote.registration, toBrain('acme', 'beta')(acmeAdmin, { name: 'anvil' })),
      ),
    ).toMatchObject({ reason: 'not_found', detail: 'There is no note anvil' });
  });

  it('are what canAccessBrain checks, for a handler that lists only the brains its caller may access', () => {
    expect([canAccessBrain('*', 'alpha'), canAccessBrain(['alpha'], 'alpha')]).toEqual([true, true]);
    expect([canAccessBrain(['alpha'], 'beta'), canAccessBrain([], 'alpha'), canAccessBrain(['alpha'], 7)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});
