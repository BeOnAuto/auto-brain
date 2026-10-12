import { allPermissions, type CallerIdentity } from '@on.auto/operations';

export const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' };

export const acmeAlphaKeeper: CallerIdentity = {
  id: 'acme-alpha-keeper',
  org: 'acme',
  permissions: ['org:read', 'org:write'],
  playbooks: ['alpha'],
};

export const acmeGammaReader: CallerIdentity = {
  id: 'acme-gamma-reader',
  org: 'acme',
  permissions: ['playbook:read'],
  playbooks: ['gamma'],
};

export const acmeReader: CallerIdentity = { id: 'acme-reader', org: 'acme', permissions: ['org:read'], playbooks: '*' };

export const globexAdmin: CallerIdentity = { ...acmeAdmin, id: 'globex-admin', org: 'globex' };
