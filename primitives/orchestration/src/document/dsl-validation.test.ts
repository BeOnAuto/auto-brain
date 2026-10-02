import { describe, expect, it } from 'vitest';

import type { Json, JsonObject } from '../dsl/json.ts';
import { header, workflow } from '../testing/workflows.ts';
import { dslProblems, schemaProblems, type Problem } from './dsl-validation.ts';

function connected(document: JsonObject): readonly Problem[] {
  return dslProblems(document, { connecting: true });
}

describe('validating a document against the DSL', () => {
  it('finds nothing wrong in a valid workflow, whether or not it connects its steps', () => {
    const valid = workflow('do:\n  - greet: { set: { a: 1 } }');

    expect(connected(valid)).toEqual([]);
    expect(dslProblems(valid, { connecting: false })).toEqual([]);
  });

  it('names the property a task lacks or the DSL does not know, at its place', () => {
    expect(connected(workflow('do:\n  - loop: { for: { each: item }, do: [] }'))).toEqual([
      { pointer: '/do/0/loop/for', detail: 'It needs in' },
    ]);
    expect(connected(workflow('do:\n  - greet: { set: { a: 1 }, bogus: 1 }'))).toEqual([
      { pointer: '/do/0/greet', detail: 'It has bogus, which the DSL does not know here' },
    ]);
  });

  it('says a task has no type the DSL knows instead of listing every type it is not', () => {
    expect(connected(workflow('do:\n  - dance: { tango: true }'))).toEqual([
      {
        pointer: '/do/0/dance',
        detail:
          'The task has no type the DSL knows: a task is one of call, do, emit, for, fork, listen, raise, run, set, switch, try, wait',
      },
    ]);
  });
});

describe('the rules of the DSL beyond its schema', () => {
  it('reject a list of tasks with the same name twice', () => {
    expect(connected(workflow('do:\n  - a: { set: { x: 1 } }\n  - a: { set: { y: 1 } }'))).toEqual([
      { pointer: '/do', detail: "The following task names are duplicated: 'a'." },
    ]);
  });

  it('reject steps that do not connect into a graph', () => {
    expect(connected(workflow('do:\n  - a: { set: { x: 1 }, then: nowhere }'))).toEqual([
      {
        pointer: '',
        detail: "The steps of the workflow do not connect: Unable to find task to transition to 'nowhere' from 'a'",
      },
    ]);
  });

  it('reject a document that is not JSON at all', () => {
    const circular: { [key: string]: Json } = { document: header, do: [] };
    circular['self'] = circular;

    expect(connected(circular)).toEqual([{ pointer: '', detail: expectedCircularity(circular) }]);
  });
});

describe('the errors of the schema', () => {
  it('are described from their keyword, once each', () => {
    expect(
      schemaProblems([
        { instancePath: '/a', keyword: 'additionalProperties', params: { additionalProperty: 'b' } },
        { instancePath: '/c', keyword: 'type', message: 'must be object', params: {} },
        { instancePath: '/c', keyword: 'type', message: 'must be object', params: {} },
        { instancePath: '/d', keyword: 'format', params: {} },
      ]),
    ).toEqual([
      { pointer: '/a', detail: 'It has b, which the DSL does not know here' },
      { pointer: '/c', detail: 'It must be object' },
      { pointer: '/d', detail: 'It breaks the rule format' },
    ]);
  });
});

function expectedCircularity(document: { readonly [key: string]: Json }): string {
  try {
    JSON.stringify(document);
    return '';
  } catch (error) {
    return String(error).replace(/^\w*Error: /u, '');
  }
}
