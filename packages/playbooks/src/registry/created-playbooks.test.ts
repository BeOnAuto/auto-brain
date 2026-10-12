import { describe, expect, it } from 'vitest';

import { playbookCreatedOf } from './created-playbooks.ts';

const context = { at: '2026-10-01T09:00:00.000Z', by: 'acme-admin' };

describe('the playbook a record of an org creates', () => {
  it('is named by its creation, and by no other record or one without who created it and when', () => {
    expect([
      playbookCreatedOf({
        type: 'playbook_created',
        data: { playbook: 'alpha', name: 'Alpha', description: '' },
        context,
      }),
      playbookCreatedOf({ type: 'playbook_retired', data: { playbook: 'alpha' }, context }),
      playbookCreatedOf({ type: 'playbook_created', data: 'not a fact', context }),
      playbookCreatedOf({ type: 'playbook_created', data: { playbook: 'alpha', name: 'Alpha', description: '' } }),
    ]).toEqual(['alpha', undefined, undefined, undefined]);
  });
});
