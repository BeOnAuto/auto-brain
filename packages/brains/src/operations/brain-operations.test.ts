import { makeCatalog } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { brainOperations } from '../index.ts';

describe('the brain operations', () => {
  const catalog = makeCatalog(brainOperations);

  it('make one catalog of five org operations', () => {
    expect(catalog.operationsIn('org').map(({ name, title }) => `${name}: ${title}`)).toEqual([
      'create_brain: Create brain',
      'list_brains: List brains',
      'get_brain: Get brain',
      'update_brain: Update brain',
      'retire_brain: Retire brain',
    ]);
    expect(catalog.operationsIn('brain')).toEqual([]);
  });

  it('answer at five different routes', () => {
    const routes = catalog.operations.map(({ route }) => `${route.method} ${route.path}`);

    expect(routes).toEqual([
      'POST /brains',
      'GET /brains',
      'GET /brains/{brain}',
      'PUT /brains/{brain}',
      'POST /brains/{brain}/retire',
    ]);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it('describe a brain once, as a shared definition', () => {
    expect(catalog.operations.map(({ output }) => Object.keys(output.definitions))).toEqual([
      ['Brain'],
      ['Brain'],
      ['Brain'],
      ['Brain'],
      ['Brain'],
    ]);
  });
});
