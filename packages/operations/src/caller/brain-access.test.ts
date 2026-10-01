import { describe, expect, it } from 'vitest';

import { mayReachBrain, type CallerIdentity } from '../index.ts';
import { getBrainLabel, labelBrain, listBrainLabels, relabelBrain } from '../testing/brain-labels.ts';
import { acmeAdmin, acmeAlphaReader } from '../testing/callers.ts';
import { harness, toBrain, toOrg } from '../testing/harness.ts';
import { getNote } from '../testing/notes.ts';

const toAcme = toOrg('acme');

const alphaWriter: CallerIdentity = { ...acmeAlphaReader, id: 'acme-alpha-writer', permissions: ['org:write'] };

const outOfReach = { status: 'refused', reason: 'forbidden', detail: 'The caller may not reach this brain' };

describe('the brain an org operation addresses', () => {
  it('is its input field named brain, wherever that field arrives from', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(dispatcher.inOrg(relabelBrain.registration, toAcme(alphaWriter, { brain: 'beta', label: 'x' }))),
    ).toEqual(outOfReach);
    expect(
      await run(dispatcher.inOrg(labelBrain.registration, toAcme(alphaWriter, { brain: 'beta', label: 'x' }))),
    ).toEqual(outOfReach);
    expect(
      await run(dispatcher.inOrg(relabelBrain.registration, toAcme(alphaWriter, { brain: 'alpha', label: 'x' }))),
    ).toEqual({ status: 'done', output: { brain: 'alpha', label: 'x' } });
  });

  it('is reached only by a caller whose list holds it, whatever the field carries', async () => {
    const { dispatcher, run } = harness();
    const asking = (input: unknown) =>
      run(dispatcher.inOrg(getBrainLabel.registration, toAcme(acmeAlphaReader, input)));

    expect([await asking({ brain: 'beta' }), await asking({ brain: 7 }), await asking({})]).toEqual([
      outOfReach,
      outOfReach,
      outOfReach,
    ]);
    expect(await asking({ brain: 'alpha' })).toEqual({
      status: 'refused',
      reason: 'not_found',
      detail: 'The brain alpha has no label',
    });
  });

  it('is recorded on the registration, and absent for an operation without a brain field', async () => {
    const { dispatcher, run } = harness();

    expect([relabelBrain, labelBrain, listBrainLabels].map(({ registration }) => registration.addressesBrain)).toEqual([
      true,
      true,
      false,
    ]);
    expect(await run(dispatcher.inOrg(listBrainLabels.registration, toAcme(acmeAlphaReader)))).toEqual({
      status: 'done',
      output: { labels: [] },
    });
  });
});

describe('the brains a caller may reach', () => {
  it('are every brain only for the star, and otherwise exactly the brains listed', async () => {
    const { dispatcher, run } = harness();
    const sloppy = { ...acmeAlphaReader };
    Reflect.set(sloppy, 'brains', 'alphabet-beta');

    expect(await run(dispatcher.inBrain(getNote.registration, toBrain('acme', 'alpha')(sloppy)))).toEqual(outOfReach);
    expect(await run(dispatcher.inBrain(getNote.registration, toBrain('acme', 'beta')(sloppy)))).toEqual(outOfReach);
    expect(
      await run(dispatcher.inBrain(getNote.registration, toBrain('acme', 'beta')(acmeAdmin, { name: 'anvil' }))),
    ).toMatchObject({ reason: 'not_found', detail: 'There is no note anvil' });
  });

  it('are checked by mayReachBrain, the rule a handler uses to list only those brains', () => {
    expect([mayReachBrain('*', 'alpha'), mayReachBrain(['alpha'], 'alpha')]).toEqual([true, true]);
    expect([mayReachBrain(['alpha'], 'beta'), mayReachBrain([], 'alpha'), mayReachBrain(['alpha'], 7)]).toEqual([
      false,
      false,
      false,
    ]);
  });
});
