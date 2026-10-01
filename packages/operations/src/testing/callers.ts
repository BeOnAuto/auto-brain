import { everyPermission, type CallerIdentity } from '../index.ts';

export const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: everyPermission, brains: '*' };

export const acmeAlphaReader: CallerIdentity = {
  id: 'acme-alpha-reader',
  org: 'acme',
  permissions: ['org:read', 'brain:read'],
  brains: ['alpha'],
};

export const globexAdmin: CallerIdentity = { ...acmeAdmin, id: 'globex-admin', org: 'globex' };
