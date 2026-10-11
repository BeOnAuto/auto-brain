import { allPermissions, type CallerIdentity } from '../index.ts';

export const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' };

export const acmeAlphaReader: CallerIdentity = {
  id: 'acme-alpha-reader',
  org: 'acme',
  permissions: ['org:read', 'playbook:read'],
  playbooks: ['alpha'],
};

export const globexAdmin: CallerIdentity = { ...acmeAdmin, id: 'globex-admin', org: 'globex' };
