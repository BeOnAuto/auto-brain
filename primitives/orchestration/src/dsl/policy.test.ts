import { describe, expect, it } from 'vitest';

import { header, workflow, yamlObject } from '../testing/workflows.ts';
import { rejectionsOf } from './policy.ts';

function pointersRejectedIn(source: string): readonly string[] {
  return rejectionsOf(workflow(source)).map(({ pointer }) => pointer);
}

const allowed = workflow(`
use:
  errors:
    late: { type: https://example.com/late, status: 408 }
  retries:
    patient: { delay: PT1S, backoff: { exponential: {} }, limit: { attempt: { count: 3 } } }
  timeouts:
    short: { after: PT5S }
input:
  from: .order
  schema:
    format: json:2020-12
    document: { type: object }
do:
  - check:
      if: .total > 0
      set: { total: '\${ .total }' }
      timeout: short
      then: done
  - done:
      raise:
        error: late
timeout:
  after: PT1H
output:
  as: '\${ { total } }'
`);

describe('the policy of a document', () => {
  it('allows a workflow of the tasks this runtime runs', () => {
    expect(rejectionsOf(allowed)).toEqual([]);
  });

  it('runs documents of DSL 1.0.x only', () => {
    expect(rejectionsOf({ document: { ...header, dsl: '0.9.0' }, do: [] })).toEqual([
      { pointer: '/document/dsl', detail: 'This runtime runs documents of DSL 1.0.x, not 0.9.0', forbidden: true },
    ]);
    expect(rejectionsOf({ do: [] })).toEqual([
      {
        pointer: '/document/dsl',
        detail: 'This runtime runs documents of DSL 1.0.x, not an unnamed version',
        forbidden: true,
      },
    ]);
  });
});

describe('the reusable components of a document', () => {
  it('are rejected when this version does not support them', () => {
    expect(
      pointersRejectedIn(`
use:
  authentications: {}
  secrets: [token]
  catalogs: {}
  extensions: []
  functions: {}
do: []
`),
    ).toEqual(['/use/authentications', '/use/secrets', '/use/catalogs', '/use/extensions', '/use/functions']);
  });

  it('are checked when they are retries, timeouts and errors', () => {
    expect(
      pointersRejectedIn(`
use:
  retries:
    broken: { delay: soon, when: '.a +', jitter: { from: PT1S, to: P1M } }
    ignored: 3
  timeouts:
    broken: { after: never }
    ignored: 3
  errors:
    broken: { type: '\${ .a + }', status: 500 }
do: []
`),
    ).toEqual([
      '/use/retries/broken/when',
      '/use/retries/broken/delay',
      '/use/retries/broken/jitter/to',
      '/use/timeouts/broken/after',
      '/use/errors/broken/type',
    ]);
  });
});

describe('the data of a document', () => {
  it('has no schedule and well-formed transforms and timeout', () => {
    expect(
      pointersRejectedIn(`
schedule: { every: PT1H }
input:
  from: .a +
output:
  as: { total: '\${ .a + }' }
timeout: missing
do: []
`),
    ).toEqual(['/schedule', '/input/from', '/output/as/total', '/timeout']);
  });

  it('checks an inline workflow timeout', () => {
    expect(pointersRejectedIn('timeout: { after: P1Y }\ndo: []')).toEqual(['/timeout/after']);
  });

  it('is read without breaking when its parts are not what the DSL says', () => {
    expect(rejectionsOf(yamlObject(`document: { dsl: '1.0.3' }\nuse: 3\ndo: { not: a list }\ninput: 3`))).toEqual([]);
  });
});

describe('the schemas of a document', () => {
  it('are inline JSON Schemas only', () => {
    expect(
      pointersRejectedIn(`
input:
  schema:
    resource: { endpoint: https://example.com/schema.json }
output:
  schema:
    format: avro
    document: {}
do: []
`),
    ).toEqual(['/input/schema/resource', '/output/schema/format']);
  });

  it('may leave out their format', () => {
    expect(rejectionsOf(workflow('input: { schema: { document: { type: object } } }\ndo: []'))).toEqual([]);
  });
});
