import type { Registration } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { createBrain, getBrain, listBrains, retireBrain, updateBrain } from '../index.ts';

const sales = {
  id: 'sales',
  name: 'Sales',
  description: 'Answers questions about the pipeline',
  status: 'active',
  created_at: '2026-10-02T09:00:00.000Z',
  created_by: 'acme-admin',
  updated_at: '2026-10-02T09:00:00.000Z',
};

const undescribed = { ...sales, description: '' };

const retired = { ...sales, id: 'old', name: 'Old', status: 'retired', retired_at: '2026-10-02T10:00:00.000Z' };

function outcomeOf({ plainLanguage }: Registration, output: unknown, input: unknown): string | undefined {
  return plainLanguage?.outcome(output, input);
}

function attemptOf({ plainLanguage }: Registration, input: unknown): string | undefined {
  return plainLanguage?.attempt(input);
}

describe('the plain language of create_brain', () => {
  it('names the brain it created, says what it is for, and what comes next', () => {
    expect(outcomeOf(createBrain.registration, sales, { brain: 'sales', name: 'Sales' })).toBe(
      'Created the brain “Sales”. What it is for: Answers questions about the pipeline. Its functions and workflows come next.',
    );
  });

  it('leaves out what it is for when it has no description', () => {
    expect(outcomeOf(createBrain.registration, undescribed, { brain: 'sales', name: 'Sales' })).toBe(
      'Created the brain “Sales”. Its functions and workflows come next.',
    );
  });

  it('names the brain it tried to create, or says what it tried when the input does not hold', () => {
    expect([
      attemptOf(createBrain.registration, { brain: 'sales', name: 'Sales' }),
      attemptOf(createBrain.registration, { brain: 'Sales' }),
    ]).toEqual(['create the brain “sales”', 'create a brain']);
  });
});

const listings: ReadonlyArray<readonly [readonly unknown[], string]> = [
  [[], 'There is no brain in use that this connection may see.'],
  [[sales], 'There is 1 brain: “Sales”.'],
  [[sales, { ...sales, id: 'support', name: 'Support' }], 'There are 2 brains: “Sales” and “Support”.'],
  [[sales, retired], 'There is 1 brain: “Sales”. Also listed, 1 retired brain: “Old”.'],
];

describe('the plain language of list_brains', () => {
  it.each(listings)('describes %j', (brains, words) => {
    expect(outcomeOf(listBrains.registration, { brains }, {})).toBe(words);
  });

  it('names at most twenty brains and counts the rest', () => {
    const brains = Array.from({ length: 23 }, (_, index) => ({ ...sales, id: `brain-${index}`, name: `B${index}` }));

    expect(outcomeOf(listBrains.registration, { brains }, {})).toMatch(
      /^There are 23 brains: “B0”, .*“B19”, and 3 more\.$/u,
    );
  });

  it('says what it tried', () => {
    expect(attemptOf(listBrains.registration, {})).toBe('list the brains');
  });
});

describe('the plain language of get_brain', () => {
  it('says whether the brain is in use and what it is for', () => {
    expect(outcomeOf(getBrain.registration, sales, { brain: 'sales' })).toBe(
      'The brain “Sales” is in use. What it is for: Answers questions about the pipeline.',
    );
  });

  it('says a retired brain can no longer change', () => {
    expect(outcomeOf(getBrain.registration, { ...retired, description: '' }, { brain: 'old' })).toBe(
      'The brain “Old” has been retired; it can no longer change.',
    );
  });

  it('names the brain it looked for', () => {
    expect([attemptOf(getBrain.registration, { brain: 'sales' }), attemptOf(getBrain.registration, {})]).toEqual([
      'look up the brain “sales”',
      'look up a brain',
    ]);
  });
});

describe('the plain language of update_brain', () => {
  it('names the brain and says what it is for now', () => {
    expect(outcomeOf(updateBrain.registration, sales, { ...sales, brain: 'sales' })).toBe(
      'Updated the brain “Sales”. What it is for: Answers questions about the pipeline.',
    );
  });

  it('says when the brain has no description any more', () => {
    expect(outcomeOf(updateBrain.registration, undescribed, { brain: 'sales', name: 'Sales', description: '' })).toBe(
      'Updated the brain “Sales”. It has no description now.',
    );
  });

  it('names the brain it tried to update', () => {
    expect(attemptOf(updateBrain.registration, { brain: 'sales', name: 'Sales', description: '' })).toBe(
      'update the brain “sales”',
    );
  });
});

describe('the plain language of retire_brain', () => {
  it('says the brain can no longer change and cannot be restored', () => {
    expect(outcomeOf(retireBrain.registration, retired, { brain: 'old' })).toBe(
      'Retired the brain “Old”. It can no longer change, and there is no way to restore it.',
    );
  });

  it('names the brain it tried to retire', () => {
    expect(attemptOf(retireBrain.registration, { brain: 'old' })).toBe('retire the brain “old”');
  });
});
