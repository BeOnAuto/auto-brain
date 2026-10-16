import { describe, expect, it } from 'vitest';

import { authenticatorFor, createApiKey, isSignedInPerson } from '../index.ts';
import { fakeIssuer, principalIn, signedTokens } from '../testing/index.ts';

const admin = createApiKey({ id: 'acme-admin', org: 'acme', permissions: ['org:write'], playbooks: '*' });

describe('a signed-in person', () => {
  it('is the caller of a token of the identity service, and neither a key nor the local developer', async () => {
    const { identityService, token } = await signedTokens(fakeIssuer('https://login.example'));
    const signingIn = authenticatorFor({ host: '0.0.0.0', apiKeys: [admin.entry], identityService });
    const local = authenticatorFor({ host: '127.0.0.1', apiKeys: undefined });

    const ids = [
      principalIn(await signingIn.authenticate(await token(), '/mcp'))?.own.id,
      principalIn(await signingIn.authenticate(admin.key, '/mcp'))?.own.id,
      principalIn(await local.authenticate(undefined, '/mcp'))?.own.id,
    ];

    expect(ids).toEqual(['person:ada', 'acme-admin', 'local']);
    expect(ids.map((id = '') => isSignedInPerson({ id }))).toEqual([true, false, false]);
  });
});
