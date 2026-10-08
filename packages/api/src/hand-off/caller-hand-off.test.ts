import { allPermissions, type CallerIdentity } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { authInfoFor, brainCallOf, orgCallOf } from './caller-hand-off.ts';

const caller: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: ['alpha'] };

const orgCall = { caller, org: 'acme', requestId: 'request-1', dropped: [{ id: 7, value: { admin: true } }] };

describe('the hand-off of a caller to the MCP SDK', () => {
  it('carries the caller id and permissions, and a placeholder instead of any credential', () => {
    expect(authInfoFor(orgCall)).toEqual({
      token: 'verified-by-auto-brain',
      clientId: 'acme-admin',
      scopes: [...allPermissions],
      extra: orgCall,
    });
  });

  it('reads back the call of an org endpoint and of a brain endpoint, with the arguments the SDK drops', () => {
    const brainCall = { ...orgCall, brain: 'alpha' };

    expect({
      org: orgCallOf({ authInfo: authInfoFor(orgCall) }),
      brain: brainCallOf({ authInfo: authInfoFor(brainCall) }),
    }).toEqual({ org: orgCall, brain: brainCall });
  });

  it('refuses to serve a request without authentication information', () => {
    expect(() => orgCallOf({})).toThrow('Expected object');
  });

  it('refuses to serve a request whose authentication information carries no caller', () => {
    expect(() => orgCallOf({ authInfo: { extra: { org: 'acme', requestId: 'request-1', dropped: [] } } })).toThrow(
      'caller',
    );
  });

  it('refuses to serve a brain endpoint without a brain', () => {
    expect(() => brainCallOf({ authInfo: authInfoFor(orgCall) })).toThrow('brain');
  });
});
