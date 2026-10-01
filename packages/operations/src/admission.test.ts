import { describe, expect, it } from 'vitest';

import type { CallerIdentity } from './index.ts';
import { getBrainLabel, labelBrain, listBrainLabels } from './testing/brain-labels.ts';
import { acmeAdmin, acmeAlphaReader } from './testing/callers.ts';
import { harness, toBrain, toOrg } from './testing/harness.ts';
import { addNote, getNote } from './testing/notes.ts';

const toAcme = toOrg('acme');

const toAlpha = toBrain('acme', 'alpha');

function holding(...permissions: CallerIdentity['permissions']): CallerIdentity {
  return { ...acmeAdmin, id: 'acme-limited', permissions };
}

describe('admission of a caller', () => {
  it('refuses a caller of another org identically for an existing and a missing brain', async () => {
    const { dispatcher, run } = harness();

    const existing = await run(dispatcher.inBrain(getNote.registration, toBrain('globex', 'gamma')(acmeAdmin)));
    const missing = await run(dispatcher.inBrain(getNote.registration, toBrain('globex', 'nowhere')(acmeAdmin)));

    expect(existing).toEqual({
      status: 'refused',
      reason: 'forbidden',
      detail: 'The caller does not belong to this org',
    });
    expect(missing).toEqual(existing);
  });

  it('checks the org of the caller before its permissions', async () => {
    const { dispatcher, run } = harness();

    expect(await run(dispatcher.inOrg(labelBrain.registration, toOrg('globex')(acmeAlphaReader)))).toMatchObject({
      detail: 'The caller does not belong to this org',
    });
  });

  it('derives the permission a call needs from the kind and the scope of the operation', async () => {
    const { dispatcher, run } = harness();

    expect(await run(dispatcher.inOrg(listBrainLabels.registration, toAcme(holding('brain:read'))))).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller lacks the org:read permission',
    });
    expect(await run(dispatcher.inOrg(labelBrain.registration, toAcme(holding('org:read'))))).toMatchObject({
      detail: 'The caller lacks the org:write permission',
    });
    expect(await run(dispatcher.inBrain(getNote.registration, toAlpha(holding('org:read'))))).toMatchObject({
      detail: 'The caller lacks the brain:read permission',
    });
    expect(await run(dispatcher.inBrain(addNote.registration, toAlpha(holding('brain:read'))))).toMatchObject({
      detail: 'The caller lacks the brain:write permission',
    });
  });
});

describe('admission to a brain', () => {
  it('refuses a brain out of reach identically whether it exists or not', async () => {
    const { dispatcher, run } = harness();

    const existing = await run(dispatcher.inBrain(getNote.registration, toBrain('acme', 'beta')(acmeAlphaReader)));
    const missing = await run(dispatcher.inBrain(getNote.registration, toBrain('acme', 'nowhere')(acmeAlphaReader)));

    expect(existing).toEqual({ status: 'refused', reason: 'forbidden', detail: 'The caller may not reach this brain' });
    expect(missing).toEqual(existing);
  });

  it('reveals that a brain is missing only to a caller that may reach it', async () => {
    const { dispatcher, run } = harness();

    expect(await run(dispatcher.inBrain(getNote.registration, toBrain('acme', 'nowhere')(acmeAdmin)))).toEqual({
      status: 'refused',
      reason: 'not_found',
      detail: 'There is no brain nowhere in this org',
    });
    expect(await run(dispatcher.inBrain(getNote.registration, toBrain('acme', 'No Brain')(acmeAdmin)))).toEqual({
      status: 'refused',
      reason: 'not_found',
      detail: 'There is no brain No Brain in this org',
    });
  });
});

describe('admission to an org', () => {
  it('checks the reach of an org operation whose route names a brain', async () => {
    const { dispatcher, run } = harness();
    const asking = (input: unknown) =>
      run(dispatcher.inOrg(getBrainLabel.registration, toAcme(acmeAlphaReader, input)));
    const outOfReach = { status: 'refused', reason: 'forbidden', detail: 'The caller may not reach this brain' };

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
    expect(await run(dispatcher.inOrg(listBrainLabels.registration, toAcme(acmeAlphaReader)))).toEqual({
      status: 'done',
      output: { labels: [] },
    });
  });

  it('treats an org id that breaks the grammar as an org that does not exist', async () => {
    const { dispatcher, run } = harness();
    const localDeveloper = { ...acmeAdmin, org: 'ac/me' };

    expect(await run(dispatcher.inOrg(listBrainLabels.registration, toOrg('ac/me')(localDeveloper)))).toEqual({
      status: 'refused',
      reason: 'not_found',
      detail: 'There is no org ac/me',
    });
  });
});
