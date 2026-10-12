import type { Registration } from '@beonauto/operations';

import { createPlaybook } from './create-brain.ts';
import { getPlaybook } from './get-brain.ts';
import { listPlaybooks } from './list-brains.ts';
import { retirePlaybook } from './retire-brain.ts';
import { updatePlaybook } from './update-brain.ts';

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
