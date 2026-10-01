import { Schema } from 'effect';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { CallerIdentitySchema, type CallerIdentity } from './index.ts';

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

  it.each(malformed)('refuses %s', (_case, identity) => {
    expect(isCallerIdentity(identity)).toBe(false);
  });
});
