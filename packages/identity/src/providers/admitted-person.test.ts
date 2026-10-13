import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { IdentityProvider, Principal } from '../index.ts';
import { admittedPerson } from './admitted-person.ts';

function personAdmitted(
  providers: readonly IdentityProvider[],
  payload: Readonly<Record<string, unknown>>,
): Principal | undefined {
  return Result.getOrUndefined(admittedPerson(providers, payload));
}

const issuer = 'https://login.example';

const acme: IdentityProvider = {
  name: 'corp',
  issuer,
  org: 'acme',
  membership: { claim: 'tid', value: 'acme-tenant' },
  grants: {
    claim: 'groups',
    by: {
      readers: { permissions: ['org:read', 'playbook:read'], playbooks: ['alpha'] },
      sales: { permissions: ['playbook:write'], playbooks: ['beta', 'alpha'] },
      admins: { permissions: ['org:write'], playbooks: '*' },
    },
  },
};

const globex: IdentityProvider = {
  name: 'corp',
  issuer,
  org: 'globex',
  grants: { claim: 'scope', by: { 'playbook:read': { permissions: ['playbook:read'], playbooks: '*' } } },
  subject: 'oid',
};

const initech: IdentityProvider = {
  name: 'corp',
  issuer,
  org: 'initech',
  membership: { claim: 'tid', value: 'initech-tenant' },
  grants: { claim: 'groups', by: { readers: { permissions: ['org:read'], playbooks: '*' } } },
};

const ada = {
  sub: 'ada',
  oid: '0f1e-2d3c',
  tid: 'acme-tenant',
  groups: ['readers', 'sales', 42],
  scope: 'openid playbook:read',
};

const admittingNothing: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
  ['a token outside the membership', { ...ada, tid: 'other-tenant' }],
  ['a token without the membership claim', { sub: 'ada', groups: ['readers'] }],
  ['values that grant nothing', { ...ada, groups: ['visitors', 'constructor', '__proto__'] }],
  ['a claim of another kind', { ...ada, groups: { readers: true } }],
  ['no subject under the claim the entry names', { ...ada, sub: undefined }],
  ['an empty subject', { ...ada, sub: '' }],
  ['a subject that is not a string', { ...ada, sub: 7 }],
  ['a subject with a control character', { ...ada, sub: 'ada\u0000' }],
];

describe('a signed-in person admitted by the entries of their issuer', () => {
  it('is admitted to each org whose entry grants something, under the subject that entry names', () => {
    const person = personAdmitted([acme, globex, initech], ada);

    expect(['acme', 'globex', 'initech'].map((org) => person?.callerIn(org))).toEqual([
      {
        id: 'person:corp/ada',
        org: 'acme',
        permissions: ['org:read', 'playbook:read', 'playbook:write'],
        playbooks: ['alpha', 'beta'],
      },
      { id: 'person:corp/0f1e-2d3c', org: 'globex', permissions: ['playbook:read'], playbooks: '*' },
      undefined,
    ]);
  });

  it('has as its own org the org of the first entry that admits them, in the order of the setting', () => {
    expect([personAdmitted([acme, globex], ada)?.org, personAdmitted([initech, globex, acme], ada)?.org]).toEqual([
      'acme',
      'globex',
    ]);
  });

  it.each([[['readers', 'admins']], [['admins', 'readers']]])(
    'may access every playbook when any of the grants says *, given %j',
    (groups: readonly string[]) => {
      expect(personAdmitted([acme], { ...ada, groups })?.callerIn('acme')?.playbooks).toBe('*');
    },
  );
});

describe('the claims of a signed-in person', () => {
  it('reads the values of a claim from an array of strings or from words separated by spaces', () => {
    expect(personAdmitted([acme], { ...ada, groups: 'readers  sales' })?.callerIn('acme')?.permissions).toEqual([
      'org:read',
      'playbook:read',
      'playbook:write',
    ]);
  });

  it.each(admittingNothing)('is admitted to no org for %s', (_case, claims: Readonly<Record<string, unknown>>) => {
    const person = personAdmitted([acme], claims);

    expect([person?.org, person?.callerIn('acme')]).toEqual([undefined, undefined]);
  });

  it('keeps the subject as it is, whatever characters it holds', () => {
    expect(personAdmitted([acme], { ...ada, sub: 'auth0|ada/ü 1' })?.callerIn('acme')?.id).toBe(
      'person:corp/auth0|ada/ü 1',
    );
  });

  it('takes a subject of 256 bytes, and refuses the token when the claim an entry names holds a longer one', () => {
    const subjectOf256Bytes = `${'ü'.repeat(127)}ab`;

    expect(personAdmitted([globex], { ...ada, oid: subjectOf256Bytes })?.callerIn('globex')?.id).toBe(
      `person:corp/${subjectOf256Bytes}`,
    );
    expect(admittedPerson([acme, globex], { ...ada, oid: `${subjectOf256Bytes}c` })).toEqual(
      Result.fail('its claim oid holds a subject of more than 256 bytes'),
    );
  });
});
