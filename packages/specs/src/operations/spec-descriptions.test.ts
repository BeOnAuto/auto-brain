import { describe, expect, it } from 'vitest';

import { makeSpecOperations } from '../index.ts';
import { echo } from '../testing/echo.ts';
import { probe } from '../testing/probe.ts';

const operations = makeSpecOperations([echo, probe().primitive]).map(({ registration }) => registration);

const takingAPrimitive = operations.filter(({ name }) => name !== 'get_execution');

describe('the description of every operation that takes a primitive', () => {
  it('lists the primitives by name and title, with the media type of their documents and their own description', () => {
    expect(takingAPrimitive).toHaveLength(6);
    for (const { description } of takingAPrimitive) {
      expect(description).toContain(
        [
          'Every brain has these primitives, each named by the `primitive` field:',
          `- \`echo\` (Echo), whose spec documents are application/json: ${echo.description}`,
          '- `probe` (Probe), whose spec documents are text/plain: Answers with its input and the execution it runs in.',
        ].join('\n'),
      );
    }
  });
});

describe('the JSON Schema of the input of the operations', () => {
  it('lists the known primitives for the primitive field', () => {
    for (const { input } of takingAPrimitive) {
      expect(input.schema).toMatchObject({
        properties: { primitive: { type: 'string', allOf: [{ enum: ['echo', 'probe'] }] } },
        additionalProperties: false,
      });
    }
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
        input: { description: 'The input of the execution: any JSON value the spec takes, {} when left out' },
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
