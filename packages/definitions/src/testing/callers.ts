import { allPermissions, type CallerIdentity } from '@beonauto/operations';

export const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' };

export const acmeReader: CallerIdentity = { id: 'acme-reader', org: 'acme', permissions: ['brain:read'], brains: '*' };

export const acmeAlphaKeeper: CallerIdentity = {
  id: 'acme-alpha-keeper',
  org: 'acme',
  permissions: ['brain:read', 'brain:write'],
  brains: ['alpha'],
};

export const globexAdmin: CallerIdentity = { ...acmeAdmin, id: 'globex-admin', org: 'globex' };
