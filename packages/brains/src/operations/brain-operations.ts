import type { Registration } from '@beonauto/operations';

import { createBrain } from './create-brain.ts';
import { getBrain } from './get-brain.ts';
import { listBrains } from './list-brains.ts';
import { retireBrain } from './retire-brain.ts';
import { updateBrain } from './update-brain.ts';

interface OrgOperation {
  readonly registration: Registration<'org'>;
}

export const brainOperations: readonly OrgOperation[] = [createBrain, listBrains, getBrain, updateBrain, retireBrain];
