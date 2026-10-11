import { describe, expect, it } from 'vitest';

import { playbookCreatedOf } from './created-playbooks.ts';

const fact = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

describe('the playbook a record of an org creates', () => {
  it('is named by its creation, and by no other record', () => {
    expect([
      playbookCreatedOf({ type: 'playbook_created', playbook: 'alpha', name: 'Alpha', description: '', ...fact }),
      playbookCreatedOf({ type: 'playbook_retired', playbook: 'alpha', ...fact }),
      playbookCreatedOf('not a record'),
    ]).toEqual(['alpha', undefined, undefined]);
  });
});
