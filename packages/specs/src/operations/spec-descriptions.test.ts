import { describe, expect, it } from 'vitest';

import { makeSpecOperations } from '../index.ts';
import { echo } from '../testing/echo.ts';
import { probe } from '../testing/probe.ts';

const operations = makeSpecOperations([echo, probe().primitive]).map(({ registration }) => registration);

const readingExecutions = new Set(['get_execution', 'list_executions', 'get_execution_history']);

const takingAPrimitive = operations.filter(({ name }) => !readingExecutions.has(name));

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

describe('the description of execute_spec', () => {
  it('names no primitive the brain does not have', () => {
    const executeSpec = operations.find(({ name }) => name === 'execute_spec');

    expect(executeSpec?.description).toContain('A primitive may start work that finishes after the call returns');
    expect(executeSpec?.description).not.toMatch(/workflow/iu);
  });
});

describe('the JSON Schema of the input of the operations', () => {
  it('lists the known primitives for the primitive field as a plain enum', () => {
    for (const { input } of takingAPrimitive) {
      expect(input.schema).toHaveProperty(['properties', 'primitive'], {
        type: 'string',
        enum: ['echo', 'probe'],
        description: 'The name of the primitive the spec belongs to: echo, probe',
      });
      expect(input.schema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });

  it('keeps every other field of the input as its schema gives it', () => {
    expect(operations[1]?.input.schema).toHaveProperty(['properties', 'include_retired'], {
      type: 'boolean',
      description: 'Whether to list retired specs as well; false when left out',
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
            'The input of the execution: any JSON value the spec takes, {} when left out, at most 262144 bytes as JSON in UTF-8',
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
