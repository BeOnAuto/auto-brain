import { describe, expect, it } from 'vitest';

import { added, crm, notes } from '../testing/additions.ts';
import { acmeReader, ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

function removing(h: Harness, id: string, caller = ada) {
  return h.call(operationNamed(h.operations, 'remove_connection'), caller, { id });
}

describe('removing a connection', () => {
  it('answers it removed, closes its link and forgets its credential, which the store held alone', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);
    await h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value: 'Bearer crm-0f3c' });
    const keptBefore = [...h.secrets.values().values()];

    const removed = await removing(h, id);

    expect(keptBefore).toEqual(['Bearer crm-0f3c']);
    expect(removed).toMatchObject({ status: 'succeeded', output: { id, status: 'removed' } });
    expect(h.secrets.values().size).toBe(0);
    expect((await h.facts()).at(-1)).toMatchObject({ type: 'connection_removed', context: { by: 'person:ada' } });
    expect(await h.call(operationNamed(h.operations, 'read_link'), ada, { id, token })).toMatchObject({
      reason: 'not_found',
    });
  });

  it('records nothing when the connection is removed already, and refuses an id the org does not have', async () => {
    const h = harness();
    const { id } = await added(h, notes);
    await removing(h, id);
    const factsBefore = (await h.facts()).length;

    expect(await removing(h, id)).toMatchObject({ status: 'succeeded', output: { status: 'removed' } });
    expect((await h.facts()).length).toBe(factsBefore);
    expect(await removing(h, 'nowhere')).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });

  it('is permitted by org:write alone', async () => {
    const h = harness();
    const { id } = await added(h, notes);

    expect(await removing(h, id, acmeReader)).toMatchObject({ status: 'rejected', reason: 'forbidden' });
  });
});
