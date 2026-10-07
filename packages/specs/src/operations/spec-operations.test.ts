import { brainOperations } from '@beonauto/brains';
import { makeCatalog } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { makeSpecOperations } from '../index.ts';
import { echo } from '../testing/echo.ts';
import { probe } from '../testing/probe.ts';

const operations = makeSpecOperations([echo, probe().primitive]);

const catalog = makeCatalog(operations);

describe('the spec operations', () => {
  it('make one catalog of eleven brain operations', () => {
    expect(catalog.operationsIn('brain').map(({ name, title }) => `${name}: ${title}`)).toEqual([
      'create_spec: Create definition',
      'list_specs: List definitions',
      'get_spec: Get definition',
      'update_spec: Update definition',
      'retire_spec: Retire definition',
      'execute_spec: Run definition',
      'get_execution: Get run',
      'cancel_execution: Cancel run',
      'list_executions: List runs',
      'get_execution_history: Get run history',
      'get_brain_analytics: Get brain analytics',
    ]);
    expect(catalog.operationsIn('org')).toEqual([]);
  });

  it('answer at eleven routes relative to the brain', () => {
    expect(catalog.operations.map(({ route }) => `${route.method} ${route.path}`)).toEqual([
      'POST /specs/{primitive}',
      'GET /specs/{primitive}',
      'GET /specs/{primitive}/{name}',
      'PUT /specs/{primitive}/{name}',
      'POST /specs/{primitive}/{name}/retire',
      'POST /specs/{primitive}/{name}/execute',
      'GET /executions/{execution_id}',
      'POST /executions/{execution_id}/cancel',
      'GET /executions',
      'GET /executions/{execution_id}/history',
      'GET /analytics',
    ]);
  });
});

describe('a catalog of the spec operations', () => {
  it('takes the brain operations as well, without a clash of names or routes', () => {
    expect(makeCatalog([...brainOperations, ...operations]).operations.map(({ name }) => name)).toEqual([
      'create_brain',
      'list_brains',
      'get_brain',
      'update_brain',
      'retire_brain',
      'create_spec',
      'list_specs',
      'get_spec',
      'update_spec',
      'retire_spec',
      'execute_spec',
      'get_execution',
      'cancel_execution',
      'list_executions',
      'get_execution_history',
      'get_brain_analytics',
    ]);
  });

  it('describes a definition and a run once each, as shared definitions', () => {
    expect(catalog.operations.map(({ output }) => Object.keys(output.definitions))).toEqual([
      ['Definition'],
      ['ListedDefinition'],
      ['Definition'],
      ['Definition'],
      ['Definition'],
      ['Run'],
      ['RunDetail'],
      ['Run'],
      ['ListedRun'],
      ['PublicEvent'],
      ['BrainAnalytics'],
    ]);
  });
});

describe('the spec operations for a list of primitives', () => {
  it('need at least one primitive', () => {
    expect(() => makeSpecOperations([])).toThrow('The spec operations need at least one primitive');
  });

  it('need primitives of distinct names', () => {
    expect(() => makeSpecOperations([echo, probe().primitive, { ...echo, title: 'Another echo' }])).toThrow(
      'The primitive name echo is used more than once',
    );
  });
});
