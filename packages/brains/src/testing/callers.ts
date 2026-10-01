import { everyPermission, type CallerIdentity } from '@beonauto/operations';

export const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: everyPermission, brains: '*' };

export const acmeAlphaKeeper: CallerIdentity = {
  id: 'acme-alpha-keeper',
  org: 'acme',
  permissions: ['org:read', 'org:write'],
  brains: ['alpha'],
};

export const acmeReader: CallerIdentity = { id: 'acme-reader', org: 'acme', permissions: ['org:read'], brains: '*' };

export const globexAdmin: CallerIdentity = { ...acmeAdmin, id: 'globex-admin', org: 'globex' };
