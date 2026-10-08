import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineQuery, type CallerIdentity } from '../index.ts';
import { labelBrain, listBrainLabels } from '../testing/brain-labels.ts';
import { acmeAdmin, acmeAlphaReader } from '../testing/callers.ts';
import { harness, toBrain, toOrg } from '../testing/harness.ts';
import { addNote, getNote } from '../testing/notes.ts';

const toAcme = toOrg('acme');

const toAlpha = toBrain('acme', 'alpha');

function holding(...permissions: CallerIdentity['permissions']): CallerIdentity {
  return { ...acmeAdmin, id: 'acme-limited', permissions };
}

describe('authorization of a caller', () => {
  it('rejects a caller of another org identically for an existing and a missing brain', async () => {
    const { dispatcher, run } = harness();

    const existing = await run(dispatcher.dispatchToBrain(getNote.registration, toBrain('globex', 'gamma')(acmeAdmin)));
    const missing = await run(
      dispatcher.dispatchToBrain(getNote.registration, toBrain('globex', 'nowhere')(acmeAdmin)),
    );

    expect(existing).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller does not belong to this org',
    });
    expect(missing).toEqual(existing);
  });

  it('checks the org of the caller before its permissions', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(dispatcher.dispatchToOrg(labelBrain.registration, toOrg('globex')(acmeAlphaReader))),
    ).toMatchObject({
      detail: 'The caller does not belong to this org',
    });
  });

  it('derives the permission a call needs from the kind and the scope of the operation', async () => {
    const { dispatcher, run } = harness();

    expect(
      await run(dispatcher.dispatchToOrg(listBrainLabels.registration, toAcme(holding('brain:read')))),
    ).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller lacks the org:read permission',
    });
    expect(await run(dispatcher.dispatchToOrg(labelBrain.registration, toAcme(holding('org:read'))))).toMatchObject({
      detail: 'The caller lacks the org:write permission',
    });
    expect(await run(dispatcher.dispatchToBrain(getNote.registration, toAlpha(holding('org:read'))))).toMatchObject({
      detail: 'The caller lacks the brain:read permission',
    });
    expect(await run(dispatcher.dispatchToBrain(addNote.registration, toAlpha(holding('brain:read'))))).toMatchObject({
      detail: 'The caller lacks the brain:write permission',
    });
  });
});

const countBrains = defineQuery('org', {
  name: 'count_brains',
  title: 'Count brains',
  description: 'Counts the brains the caller may read.',
  route: { method: 'GET', path: '/brain-count' },
  inputSchema: Schema.Record(Schema.String, Schema.Never),
  outputSchema: Schema.Struct({ counted: Schema.Boolean }),
  reasons: [],
  permittedBy: ['org:read', 'brain:read'],
  handle: () => Effect.succeed({ counted: true }),
});

describe('an operation permitted by more than one permission', () => {
  it('reaches a caller that holds any one of them, and refuses one that holds none, naming each', async () => {
    const { dispatcher, run } = harness();

    expect(await run(dispatcher.dispatchToOrg(countBrains.registration, toAcme(holding('brain:read'))))).toEqual({
      status: 'succeeded',
      output: { counted: true },
    });
    expect(await run(dispatcher.dispatchToOrg(countBrains.registration, toAcme(holding('org:write'))))).toMatchObject({
      reason: 'forbidden',
      detail: 'The caller lacks the org:read or brain:read permission',
    });
  });
});

describe('access to a brain', () => {
  it('rejects a brain the caller may not access, identically whether it exists or not', async () => {
    const { dispatcher, run } = harness();

    const existing = await run(
      dispatcher.dispatchToBrain(getNote.registration, toBrain('acme', 'beta')(acmeAlphaReader)),
    );
    const missing = await run(
      dispatcher.dispatchToBrain(getNote.registration, toBrain('acme', 'nowhere')(acmeAlphaReader)),
    );

    expect(existing).toEqual({
      status: 'rejected',
      reason: 'forbidden',
      detail: 'The caller may not access this brain',
    });
    expect(missing).toEqual(existing);
  });

  it('reveals that a brain is missing only to a caller that may access it', async () => {
    const { dispatcher, run } = harness();

    expect(await run(dispatcher.dispatchToBrain(getNote.registration, toBrain('acme', 'nowhere')(acmeAdmin)))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no brain nowhere in this org',
    });
  });

  it('rejects an ill-formed brain id before asking the registry, without echoing it', async () => {
    const { dispatcher, run } = harness({ brains: [{ org: 'acme', brain: 'No Brain' }] });

    expect(await run(dispatcher.dispatchToBrain(getNote.registration, toBrain('acme', 'No Brain')(acmeAdmin)))).toEqual(
      {
        status: 'rejected',
        reason: 'not_found',
        detail: 'There is no such brain in this org',
      },
    );
  });
});

describe('a retired brain', () => {
  const retiredBrains = [{ org: 'acme', brain: 'omega' }];
  const toOmega = toBrain('acme', 'omega');

  it('answers every query, so what it recorded stays readable', async () => {
    const { dispatcher, run } = harness({ retiredBrains });

    expect(await run(dispatcher.dispatchToBrain(getNote.registration, toOmega(acmeAdmin, { name: 'anvil' })))).toEqual({
      status: 'rejected',
      reason: 'not_found',
      detail: 'There is no note anvil',
    });
  });

  it('refuses every command with the conflict update_brain gives for a retired brain', async () => {
    const { dispatcher, ledger, run } = harness({ retiredBrains });

    expect(
      await run(dispatcher.dispatchToBrain(addNote.registration, toOmega(acmeAdmin, { name: 'anvil', text: 'heavy' }))),
    ).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The brain omega is retired and can no longer change',
      kind: 'retired',
    });
    expect(ledger.streamNames()).toEqual([]);
  });
});

describe('the org id of a call', () => {
  const illFormed = 'ac/me';
  const localDeveloper = { ...acmeAdmin, org: illFormed };

  it('is checked after the caller, at org and at brain scope', async () => {
    const { dispatcher, run } = harness();
    const writingOnly: CallerIdentity = { ...localDeveloper, permissions: ['brain:write'] };

    expect(
      await run(dispatcher.dispatchToOrg(listBrainLabels.registration, toOrg(illFormed)(acmeAdmin))),
    ).toMatchObject({
      detail: 'The caller does not belong to this org',
    });
    expect(
      await run(dispatcher.dispatchToBrain(getNote.registration, toBrain(illFormed, 'alpha')(acmeAdmin))),
    ).toMatchObject({
      detail: 'The caller does not belong to this org',
    });
    expect(
      await run(dispatcher.dispatchToOrg(listBrainLabels.registration, toOrg(illFormed)(writingOnly))),
    ).toMatchObject({
      detail: 'The caller lacks the org:read permission',
    });
    expect(
      await run(dispatcher.dispatchToBrain(getNote.registration, toBrain(illFormed, 'alpha')(writingOnly))),
    ).toMatchObject({
      detail: 'The caller lacks the brain:read permission',
    });
  });

  it('must be well formed, at org and at brain scope', async () => {
    const { dispatcher, run } = harness({ brains: [{ org: illFormed, brain: 'alpha' }] });
    const noSuchOrg = { status: 'rejected', reason: 'not_found', detail: 'There is no such org' };

    expect(await run(dispatcher.dispatchToOrg(listBrainLabels.registration, toOrg(illFormed)(localDeveloper)))).toEqual(
      noSuchOrg,
    );
    expect(
      await run(dispatcher.dispatchToBrain(getNote.registration, toBrain(illFormed, 'alpha')(localDeveloper))),
    ).toEqual(noSuchOrg);
  });
});

describe('a rejection of authorization', () => {
  it('is a value of its own that a consumer may not spoil for later calls', async () => {
    const { dispatcher, run } = harness();
    const accessDenied = () =>
      run(dispatcher.dispatchToBrain(getNote.registration, toBrain('acme', 'beta')(acmeAlphaReader)));
    const abroad = () => run(dispatcher.dispatchToBrain(getNote.registration, toBrain('globex', 'gamma')(acmeAdmin)));

    Reflect.set(await accessDenied(), 'detail', 'spoiled');
    Reflect.set(await abroad(), 'detail', 'spoiled');

    expect(await accessDenied()).toMatchObject({ detail: 'The caller may not access this brain' });
    expect(await abroad()).toMatchObject({ detail: 'The caller does not belong to this org' });
  });
});
