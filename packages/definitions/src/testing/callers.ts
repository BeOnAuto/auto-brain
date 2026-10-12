import { allPermissions, type CallerIdentity } from '@beonauto/operations';

export const acmeAdmin: CallerIdentity = { id: 'acme-admin', org: 'acme', permissions: allPermissions, playbooks: '*' };

export const acmeReader: CallerIdentity = {
  id: 'acme-reader',
  org: 'acme',
  permissions: ['playbook:read'],
  playbooks: '*',
};

export const acmeAlphaKeeper: CallerIdentity = {
  id: 'acme-alpha-keeper',
  org: 'acme',
  permissions: ['playbook:read', 'playbook:write'],
  playbooks: ['alpha'],
};

export const globexAdmin: CallerIdentity = { ...acmeAdmin, id: 'globex-admin', org: 'globex' };
