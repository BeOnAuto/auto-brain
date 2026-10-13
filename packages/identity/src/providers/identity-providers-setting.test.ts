import { describe, expect, it } from 'vitest';

import { InvalidIdentityProvidersError, readIdentityProviders, type IdentityProvider } from '../index.ts';

const corp: IdentityProvider = {
  name: 'corp',
  issuer: 'https://login.example/tenant',
  org: 'acme',
  membership: { claim: 'tid', value: 'acme-tenant' },
  grants: { claim: 'groups', by: { engineers: { permissions: ['playbook:read'], playbooks: '*' } } },
  subject: 'oid',
};

const globex: IdentityProvider = {
  name: 'corp',
  issuer: 'https://login.example/tenant',
  org: 'globex',
  grants: { claim: 'https://example.com/roles', by: { admin: { permissions: ['org:write'], playbooks: ['alpha'] } } },
};

function errorFrom(providers: unknown): unknown {
  try {
    readIdentityProviders({ IDENTITY_PROVIDERS: JSON.stringify(providers) });
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('readIdentityProviders', () => {
  it.each([undefined, '', ' \n'])('lists no provider when IDENTITY_PROVIDERS is %j', (value) => {
    expect(readIdentityProviders({ IDENTITY_PROVIDERS: value })).toEqual([]);
  });

  it('decodes a list of entries, several of them for one issuer, each for its org', () => {
    expect(readIdentityProviders({ IDENTITY_PROVIDERS: JSON.stringify([corp, globex]) })).toEqual([corp, globex]);
  });

  it.each([
    'https://login.example',
    'https://login.example/',
    'https://login.example:8443/realms/acme',
    'https://login.example/tenant/v2.0',
  ])('takes the issuer %s', (issuer) => {
    expect(readIdentityProviders({ IDENTITY_PROVIDERS: JSON.stringify([{ ...corp, issuer }]) })[0]?.issuer).toBe(
      issuer,
    );
  });
});

const refusedEntries: ReadonlyArray<readonly [string, unknown, string]> = [
  ['a name outside the grammar', { ...corp, name: 'Corp' }, 'IDENTITY_PROVIDERS[0].name: Expected a string matching'],
  [
    'an issuer over http',
    { ...corp, issuer: 'http://login.example' },
    'IDENTITY_PROVIDERS[0].issuer: Expected an https URL',
  ],
  ['an issuer with a query', { ...corp, issuer: 'https://login.example/?tenant=acme' }, 'IDENTITY_PROVIDERS[0].issuer'],
  ['an issuer with a fragment', { ...corp, issuer: 'https://login.example/#acme' }, 'IDENTITY_PROVIDERS[0].issuer'],
  ['an issuer with a user', { ...corp, issuer: 'https://ada@login.example' }, 'IDENTITY_PROVIDERS[0].issuer'],
  [
    'an issuer not written as the provider writes it',
    { ...corp, issuer: 'https://Login.example' },
    'IDENTITY_PROVIDERS[0].issuer',
  ],
  ['an issuer that is no URL', { ...corp, issuer: 'login.example' }, 'IDENTITY_PROVIDERS[0].issuer'],
  [
    'the org of local mode',
    { ...corp, org: 'local' },
    'IDENTITY_PROVIDERS[0].org: This org id is reserved for local mode',
  ],
  [
    'a membership value with a space',
    { ...corp, membership: { claim: 'tid', value: 'a b' } },
    'IDENTITY_PROVIDERS[0].membership.value',
  ],
  ['an empty claim name', { ...corp, grants: { ...corp.grants, claim: '' } }, 'IDENTITY_PROVIDERS[0].grants.claim'],
  [
    'grants that grant nothing',
    { ...corp, grants: { claim: 'groups', by: {} } },
    'IDENTITY_PROVIDERS[0].grants.by: Expected at least one value that grants',
  ],
  [
    'an unknown permission',
    { ...corp, grants: { claim: 'groups', by: { x: { permissions: ['admin'], playbooks: '*' } } } },
    'IDENTITY_PROVIDERS[0].grants.by.x.permissions[0]',
  ],
  ['a field it does not know', { ...corp, audience: 'https://runtime.example' }, 'IDENTITY_PROVIDERS[0].audience'],
  ['a missing field', { name: 'corp', issuer: corp.issuer, org: 'acme' }, 'IDENTITY_PROVIDERS[0].grants: Missing key'],
];

describe('readIdentityProviders refusing an entry', () => {
  it.each(refusedEntries)('refuses %s, naming the entry and the field', (_case, entry: unknown, mention) => {
    const error = errorFrom([entry]);

    expect(error).toBeInstanceOf(InvalidIdentityProvidersError);
    expect(String(error)).toContain(mention);
  });

  it.each([
    [
      'two entries for one org and issuer',
      [corp, { ...corp, membership: undefined }],
      'The org acme has two entries for the issuer https://login.example/tenant; an org has at most one entry for each issuer',
    ],
    [
      'two names for one issuer',
      [corp, { ...globex, name: 'other' }],
      'The entry for the org acme gives the name corp to the issuer https://login.example/tenant, and the entry for the org globex gives the name other to the issuer https://login.example/tenant; an issuer has one name, and a name one issuer',
    ],
    [
      'one name for two issuers',
      [corp, { ...globex, issuer: 'https://other.example' }],
      'The entry for the org acme gives the name corp to the issuer https://login.example/tenant, and the entry for the org globex gives the name corp to the issuer https://other.example; an issuer has one name, and a name one issuer',
    ],
  ])('refuses %s, naming the org and the issuer of the entries', (_case, providers: unknown, words) => {
    expect(String(errorFrom(providers))).toBe(`InvalidIdentityProvidersError: IDENTITY_PROVIDERS: ${words}`);
  });

  it('refuses text that is not JSON', () => {
    expect(() => readIdentityProviders({ IDENTITY_PROVIDERS: '[{name:corp}]' })).toThrow(InvalidIdentityProvidersError);
  });
});
