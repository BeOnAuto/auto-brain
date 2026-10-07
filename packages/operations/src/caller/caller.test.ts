import { Schema } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  CallerIdentitySchema,
  brainCallerOf,
  canAccessBrain,
  requestTokenCallerOf,
  type CallerIdentity,
} from '../index.ts';

const isCallerIdentity = Schema.is(CallerIdentitySchema);

const keyHolder = { id: 'build-bot', org: 'acme', permissions: ['brain:read', 'org:read'], brains: ['alpha'] };

describe('a caller identity', () => {
  it('decodes into the identity the dispatcher takes', () => {
    expectTypeOf<typeof CallerIdentitySchema.Type>().toExtend<CallerIdentity>();
    expect(Schema.decodeUnknownSync(CallerIdentitySchema)(keyHolder)).toEqual(keyHolder);
    expect(isCallerIdentity({ ...keyHolder, brains: '*' })).toBe(true);
  });

  const malformed: ReadonlyArray<readonly [string, unknown]> = [
    ['an empty id', { ...keyHolder, id: '' }],
    ['an ill-formed org', { ...keyHolder, org: 'ac/me' }],
    ['an unknown permission', { ...keyHolder, permissions: ['org:admin'] }],
    ['brains as a plain string', { ...keyHolder, brains: 'alphabet-beta' }],
    ['an ill-formed brain', { ...keyHolder, brains: ['Alpha'] }],
  ];

  it.each(malformed)('rejects %s', (_case, identity) => {
    expect(isCallerIdentity(identity)).toBe(false);
  });

  it('carries the token of a request it presented, and never an empty one', () => {
    expect(isCallerIdentity({ ...keyHolder, requestToken: 'abc' })).toBe(true);
    expect(isCallerIdentity({ ...keyHolder, requestToken: '' })).toBe(false);
    expect(isCallerIdentity(requestTokenCallerOf('acme', 'abc'))).toBe(true);
  });
});

describe('the caller a brain acts as itself', () => {
  it('may read and write that brain alone, and names the brain in a way no key id can', () => {
    const brain = brainCallerOf({ org: 'acme', brain: 'alpha' });

    expect(isCallerIdentity(brain)).toBe(true);
    expect(brain).toEqual({
      id: 'brain:alpha',
      org: 'acme',
      permissions: ['brain:read', 'brain:write'],
      brains: ['alpha'],
    });
    expect([canAccessBrain(brain.brains, 'alpha'), canAccessBrain(brain.brains, 'beta')]).toEqual([true, false]);
  });
});
