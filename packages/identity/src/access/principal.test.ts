import { describe, expect, it } from 'vitest';

import { requestTokenHolderOf } from '../index.ts';

describe('the holder of the answer token of a request', () => {
  it('holds no permission and no brain in the org a call names, and hands the token on unverified', () => {
    const holder = requestTokenHolderOf('a-request-token');

    expect(holder.requestToken).toBe('a-request-token');
    expect(holder.callerIn('acme')).toEqual({
      id: 'request-token',
      org: 'acme',
      permissions: [],
      brains: [],
      requestToken: 'a-request-token',
    });
  });
});
