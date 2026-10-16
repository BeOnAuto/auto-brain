import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { added, billing, crm } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';

const ShownCredentialSchema = Schema.Record(Schema.String, Schema.String);

const decodeRead = Schema.decodeUnknownSync(
  Schema.Struct({ output: Schema.Struct({ credential: ShownCredentialSchema }) }),
);

const decodeListed = Schema.decodeUnknownSync(
  Schema.Struct({
    output: Schema.Struct({ connections: Schema.Array(Schema.Struct({ credential: ShownCredentialSchema })) }),
  }),
);

async function givenCredential(h: Harness, input: Readonly<Record<string, string>>) {
  return decodeRead(await h.call(operationNamed(h.operations, 'give_credential'), ada, input)).output.credential;
}

async function credentialsShown(h: Harness, id: string) {
  const listed = decodeListed(await h.call(operationNamed(h.operations, 'list_connections'), ada, {}));
  const read = decodeRead(await h.call(operationNamed(h.operations, 'get_connection'), ada, { id }));
  return [...listed.output.connections.map(({ credential }) => credential), read.output.credential];
}

const inTheHeader = { kind: 'secret', name: 'Authorization', in: 'header' };

describe('the ending of a credential given', () => {
  it('is the last four characters of a secret of twelve, which the list and the read show with the credential', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    expect(await givenCredential(h, { id, token, value: 'crm-key-1234' })).toEqual({
      ...inTheHeader,
      ends_with: '1234',
    });
    expect(await credentialsShown(h, id)).toEqual([
      { ...inTheHeader, ends_with: '1234' },
      { ...inTheHeader, ends_with: '1234' },
    ]);
  });

  it('is not kept of a secret of eleven', async () => {
    const h = harness();
    const { id, token } = await added(h, crm);

    expect(await givenCredential(h, { id, token, value: 'crm-key-123' })).toEqual(inTheHeader);
    expect(await credentialsShown(h, id)).toEqual([inTheHeader, inTheHeader]);
    expect(JSON.stringify(await h.facts())).not.toContain('ends_with');
  });

  it('is kept of a client secret, and never of a private key', async () => {
    const h = harness();
    const secret = await added(h, billing);
    const key = await added(h, { ...billing, name: 'billing-key' });

    const ofTheSecret = await givenCredential(h, {
      id: secret.id,
      token: secret.token,
      client_secret: 'billing-client-secret',
    });
    const ofTheKey = await givenCredential(h, {
      id: key.id,
      token: key.token,
      private_key: '-----BEGIN PRIVATE KEY-----MC4CAQAwBQYDK2VwBCIEIA',
      algorithm: 'EdDSA',
    });

    expect([ofTheSecret, ofTheKey]).toEqual([{ ...billing.credential, ends_with: 'cret' }, billing.credential]);
  });
});
