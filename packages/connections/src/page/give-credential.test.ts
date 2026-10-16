import { describe, expect, it } from 'vitest';

import { added, billing, crm, issuesIn, notes } from '../testing/additions.ts';
import { ada, grace, harness, operationNamed, type Harness } from '../testing/harness.ts';

function giving(h: Harness, input: Readonly<Record<string, string>>, caller = ada, at?: string) {
  return h.call(operationNamed(h.operations, 'give_credential'), caller, input, at);
}

describe('giving the credential of a connection', () => {
  it('keeps exactly its value in the secret store, records its id, approves the connection and uses the link up', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    const given = await giving(h, { id, token, value: 'Bearer crm-0f3c' });

    expect(given).toMatchObject({ status: 'succeeded', output: { id, status: 'connected' } });
    expect([...h.secrets.values()]).toEqual([['secret-1', 'Bearer crm-0f3c']]);
    const facts = await h.facts();
    expect(facts.slice(2).map(({ type, data }) => [type, data])).toEqual([
      ['connection_approved', { connection: id }],
      ['connection_connected', { connection: id, secret_id: 'secret-1' }],
    ]);
    expect(JSON.stringify(facts)).not.toContain('crm-0f3c');
    expect(await giving(h, { id, token, value: 'Bearer crm-again' })).toMatchObject({ reason: 'not_found' });
  });

  it('names who gave the value as who connected it, beside when, which in local mode need not be who added it', async () => {
    const h = harness({ access: 'local' });
    const { id, token } = await added(h, crm);

    expect(await giving(h, { id, token, value: 'Bearer crm-0f3c' }, grace, '2026-10-15T14:04:00.000Z')).toMatchObject({
      output: {
        added_by: 'person:ada',
        connected_at: '2026-10-15T14:04:00.000Z',
        connected_by: 'person:grace',
      },
    });
    expect(await h.call(operationNamed(h.operations, 'get_connection'), ada, { id })).toMatchObject({
      output: { connected_by: 'person:grace' },
    });
  });

  it('takes the client secret of client credentials, or a private key with its algorithm, which the fact names', async () => {
    const h = harness();
    const secret = await added(h, billing);
    const key = await added(h, { ...billing, name: 'billing-key' });

    await giving(h, { id: secret.id, token: secret.token, client_secret: 'billing-client-secret' });
    await giving(h, { id: key.id, token: key.token, private_key: '-----BEGIN PRIVATE KEY-----', algorithm: 'ES256' });

    expect([...h.secrets.values().values()]).toEqual(['billing-client-secret', '-----BEGIN PRIVATE KEY-----']);
    expect((await h.facts()).at(-1)?.data).toEqual({ connection: key.id, secret_id: 'secret-2', algorithm: 'ES256' });
  });
});

const wrongFields = [
  [
    'a secret given as a client secret',
    crm,
    { client_secret: 'x' },
    'Expected value alone, the secret of a credential of the kind secret',
  ],
  [
    'client credentials given as a value',
    billing,
    { value: 'x' },
    'Expected client_secret, or private_key with its algorithm, one of the two',
  ],
  [
    'a private key without its algorithm',
    billing,
    { private_key: 'x' },
    'Expected client_secret, or private_key with its algorithm, one of the two',
  ],
] as const;

describe('a credential given in the wrong fields', () => {
  it.each(wrongFields)('is refused for %s, and nothing is kept', async (_, input, fields, detail) => {
    const h = harness();
    const { id, token } = await added(h, input);

    expect(issuesIn(await giving(h, { id, token, ...fields }))).toEqual([{ pointer: '', detail }]);
    expect(h.secrets.values().size).toBe(0);
  });

  it('refuses a value the store will not keep, at its place, and keeps nothing', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    expect(issuesIn(await giving(h, { id, token, value: 'x'.repeat(65) }))).toEqual([
      { pointer: '/value', detail: 'A secret to keep holds more than 64 characters' },
    ]);
    expect(h.secrets.values().size).toBe(0);
  });

  it('refuses a connection that takes no credential to give, a link of another person and an expired link', async () => {
    const h = harness();
    const none = await added(h, notes);
    const { id, token } = await added(h, crm);

    expect(await giving(h, { id: none.id, token: none.token, value: 'x' })).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail: 'The connection notes takes no credential to give, so it is approved as it is',
    });
    expect(await giving(h, { id, token, value: 'x' }, grace)).toMatchObject({ reason: 'forbidden' });
    expect(await giving(h, { id, token, value: 'x' }, ada, '2026-10-15T14:10:00.000Z')).toMatchObject({
      reason: 'not_found',
    });
    expect(h.secrets.values().size).toBe(0);
  });

  it('forgets the value it kept when the connection changed before the credential was recorded', async () => {
    const removal: { run: () => Promise<unknown> } = { run: () => Promise.resolve() };
    const h = harness({ beforeKeeping: () => removal.run() });
    const { id, token } = await added(h, crm);
    removal.run = () => h.call(operationNamed(h.operations, 'remove_connection'), ada, { id });

    expect(await giving(h, { id, token, value: 'Bearer crm-0f3c' })).toMatchObject({ reason: 'not_found' });
    expect(h.secrets.values().size).toBe(0);
  });
});
