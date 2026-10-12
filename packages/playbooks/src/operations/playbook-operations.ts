import type { Registration } from '@on.auto/operations';

import { createPlaybook } from './create-playbook.ts';
import { getPlaybook } from './get-playbook.ts';
import { listPlaybooks } from './list-playbooks.ts';
import { retirePlaybook } from './retire-playbook.ts';
import { updatePlaybook } from './update-playbook.ts';

interface OrgOperation {
  readonly registration: Registration<'org'>;
}

export const playbookOperations: readonly OrgOperation[] = [
  createPlaybook,
  listPlaybooks,
  getPlaybook,
  updatePlaybook,
  retirePlaybook,
];
