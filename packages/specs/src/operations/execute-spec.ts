import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { ExecutionSchema } from '../execution/execution.ts';
import { mostInputBytes, mostResultBytes } from '../execution/recorded-size.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { executeRequest } from './execution-running.ts';
import { ExecutionIdField, InputField, SpecNameField } from './spec-fields.ts';

export function defineExecuteSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  return known.publish(
    defineCommand('brain', {
      name: 'execute_spec',
      title: 'Execute spec',
      description: known.describe([
        'Runs the active latest version of a spec of the brain with an input, records the execution,',
        'and returns it with its output when it succeeded.',
        'Some primitives, such as workflows, start work that finishes after the call returns:',
        'the execution then answers with status started, and get_execution shows it started until that work ends it.',
        '`primitive` names the primitive and `name` the spec.',
        '`input` is the JSON value the spec takes, {} when left out; get_spec shows its input_schema when it has one.',
        `The input may take at most ${mostInputBytes} bytes as JSON in UTF-8, or the call is rejected with`,
        'invalid_input at /input before anything is recorded.',
        `The output and the record of what the primitive did may take at most ${mostResultBytes} bytes together;`,
        'a primitive that answers with more fails the execution.',
        '`execution_id` is an optional UUID that names the execution so that a call can be retried safely;',
        'without it, a new id is made, and the execution answers with it.',
        'Once an execution succeeded, or its input was rejected as invalid, a call with its id and the same spec',
        'and input runs nothing and answers the same again; so does a call with the id of an execution',
        'that waits for work it started to end, answering it as it stands.',
        'Until then, a call with its id runs the spec again: after the server stopped during a run,',
        'after unavailable or a conflict the primitive found, or after the execution failed.',
        'Rejected with not_found when there is no such primitive or spec;',
        'with conflict when the spec is retired, when its document no longer parses, when the primitive finds',
        'that the spec cannot run as written (update the spec, then try again), when the execution id belongs',
        'to another spec or input, or when another call recorded on the same execution at the same moment;',
        'with invalid_input when the primitive rejects the input, with issues under /input;',
        'and with unavailable when something the primitive depends on cannot serve now, in which case try again later.',
        'The rejections by the primitive (invalid_input, unavailable, and the conflict it finds) are recorded on the execution.',
      ]),
      route: { method: 'POST', path: '/specs/{primitive}/{name}/execute' },
      inputSchema: Schema.Struct({
        primitive: known.field,
        name: SpecNameField,
        input: Schema.optionalKey(InputField),
        execution_id: Schema.optionalKey(ExecutionIdField),
      }),
      outputSchema: ExecutionSchema,
      reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name, input = {}, execution_id: suppliedId }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        return yield* executeRequest(primitive, { primitive: primitive.name, name, input }, suppliedId);
      }),
    }),
  );
}
