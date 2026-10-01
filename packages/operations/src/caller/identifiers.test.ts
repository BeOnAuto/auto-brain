import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { BrainAccessSchema, BrainIdSchema, OrgIdSchema } from '../index.ts';

const isOrgId = Schema.is(OrgIdSchema);

const isBrainId = Schema.is(BrainIdSchema);

const isBrainAccess = Schema.is(BrainAccessSchema);

describe('an org id', () => {
  it.each(['acme', 'Acme_Corp-1', 'a'.repeat(64)])('may be %s', (id) => {
    expect(isOrgId(id)).toBe(true);
  });

  it.each(['', 'a'.repeat(65), 'ac/me', 'ac me', 'acmé', 'acme:x'])('may not be %j', (id) => {
    expect(isOrgId(id)).toBe(false);
  });
});

describe('a brain id', () => {
  it.each(['abc', 'alpha-2', `a${'b'.repeat(47)}`])('may be %s', (id) => {
    expect(isBrainId(id)).toBe(true);
  });

  it.each(['ab', 'Alpha', '1alpha', 'al_pha', `a${'b'.repeat(48)}`, 'alpha/beta'])('may not be %j', (id) => {
    expect(isBrainId(id)).toBe(false);
  });
});

describe('the brains a caller may access', () => {
  it('are every brain or a list of brain ids', () => {
    expect([isBrainAccess('*'), isBrainAccess([]), isBrainAccess(['alpha', 'beta'])]).toEqual([true, true, true]);
    expect([isBrainAccess('alpha'), isBrainAccess(['Alpha'])]).toEqual([false, false]);
  });
});
