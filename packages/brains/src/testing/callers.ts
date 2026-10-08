import { allPermissions, type CallerIdentity } from '@beonauto/operations';

export const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, brains: '*' };

export const acmeAlphaKeeper: CallerIdentity = {
  id: 'acme-alpha-keeper',
  org: 'acme',
  permissions: ['org:read', 'org:write'],
  brains: ['alpha'],
};

export const acmeGammaReader: CallerIdentity = {
  id: 'acme-gamma-reader',
  org: 'acme',
  permissions: ['brain:read'],
  brains: ['gamma'],
};

export const acmeReader: CallerIdentity = { id: 'acme-reader', org: 'acme', permissions: ['org:read'], brains: '*' };

export const globexAdmin: CallerIdentity = { ...acmeAdmin, id: 'globex-admin', org: 'globex' };
