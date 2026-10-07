import { describe, expect, it } from 'vitest';

import { makeSpecOperations } from '../index.ts';
import { echo } from '../testing/echo.ts';
import { probe } from '../testing/probe.ts';

const operations = makeSpecOperations([echo, probe().primitive]).map(({ registration }) => registration);

const onRuns = new Set([
  'get_execution',
  'cancel_execution',
  'list_executions',
  'get_execution_history',
  'get_brain_analytics',
]);

const takingAPrimitive = operations.filter(({ name }) => !onRuns.has(name));

function described(name: string): string {
  return String(operations.find((operation) => operation.name === name)?.description);
}

describe('the description of create_spec', () => {
  it('names each definition type the brain runs, the kind of definition it is and the guide to its format', () => {
    expect(described('create_spec')).toContain(
      "`primitive` is the definition's type and `name` is how workflows and other tools refer to it: echo, a greeting, guide echo; probe, a probe, guide probe.",
    );
  });
});

describe('the description of every operation', () => {
  it('stays under 800 characters', () => {
    expect(operations.filter(({ description }) => description.length >= 800)).toEqual([]);
  });

  it('carries no format and no catalogue of refusals', () => {
    expect(operations.filter(({ description }) => /Rejected with|^---$|```/mu.test(description))).toEqual([]);
  });
});

describe('the JSON Schema of the input of the operations', () => {
  it('lists the known primitives for the primitive field as a plain enum, with the kind each names', () => {
    for (const { input } of takingAPrimitive) {
      expect(input.schema).toHaveProperty(['properties', 'primitive'], {
        type: 'string',
        enum: ['echo', 'probe'],
        description: "The definition's type: echo for a greeting or probe for a probe",
      });
      expect(input.schema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });

  it('keeps every other field of the input as its schema gives it', () => {
    expect(operations[1]?.input.schema).toHaveProperty(['properties', 'include_retired'], {
      type: 'boolean',
      description: 'Whether to list retired definitions as well; false when left out',
    });
    expect(operations[2]?.input.schema).toHaveProperty('required', ['primitive', 'name']);
  });

  it('holds a spec name to its pattern and a document to at most 65536 characters', () => {
    expect(operations[0]?.input.schema).toMatchObject({
      properties: {
        name: { type: 'string', pattern: '^[a-z][a-z0-9-]{2,47}$' },
        source: { type: 'string', maxLength: 65_536 },
      },
      required: ['primitive', 'name', 'source'],
    });
  });

  it('takes any JSON value as the input of an execution, and a UUID as its id', () => {
    expect(operations[5]?.input.schema).toMatchObject({
      properties: {
        input: {
          description:
            'The run input: any JSON value the definition takes, {} when left out, at most 262144 bytes as JSON in UTF-8 and 512 levels deep',
        },
        execution_id: { type: 'string', format: 'uuid' },
      },
      required: ['primitive', 'name'],
    });
    expect(operations[6]?.input.schema).toMatchObject({
      properties: { execution_id: { type: 'string', format: 'uuid' } },
      required: ['execution_id'],
    });
  });
});

describe('the JSON Schema of the filters of the runs', () => {
  it('describes the runs a filter keeps', () => {
    const listing = operations.find(({ name }) => name === 'list_executions');

    expect(listing?.input.schema).toMatchObject({
      properties: {
        primitive: {
          description: 'Only the runs of definitions of this type: echo for a greeting or probe for a probe',
        },
        name: { description: 'Only the runs of the definition with this name' },
      },
    });
  });
});

describe('what the operations declare of a repeated call', () => {
  it('declares retiring a definition and cancelling a run irreversible, and updating and retiring repeatable', () => {
    const declared = Object.fromEntries(
      operations
        .filter(({ kind }) => kind === 'command')
        .map(({ name, irreversible, repeatable }) => [name, { irreversible, repeatable }]),
    );

    expect(declared).toEqual({
      create_spec: { irreversible: false, repeatable: false },
      update_spec: { irreversible: false, repeatable: true },
      retire_spec: { irreversible: true, repeatable: true },
      execute_spec: { irreversible: false, repeatable: false },
      cancel_execution: { irreversible: true, repeatable: true },
    });
  });
});
