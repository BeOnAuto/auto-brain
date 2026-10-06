import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { RunSchema } from '../execution/execution.ts';
import { mostInputBytes, mostInputDepth, mostResultBytes } from '../execution/recorded-size.ts';
import { runPlainLanguage } from '../plain-language/run-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { executeRequest } from './execution-running.ts';
import { ExecutionIdField, InputField, SpecNameField } from './spec-fields.ts';

const description = [
  'Runs the active latest version of a definition with an input, records the run,',
  'and returns it with its output when it succeeded.',
  'Work may finish after the call returns:',
  'the run then answers with status started, and get_execution shows it started until that work ends it.',
  '`primitive` selects the API type identifier and `name` the definition.',
  '`input` is the JSON value the definition takes, {} when left out; get_spec shows its input_schema when it has one.',
  `The input may take at most ${mostInputBytes} bytes as JSON in UTF-8 and nest at most ${mostInputDepth} levels deep,`,
  'or the call is rejected with',
  'invalid_input at /input before anything is recorded.',
  `The output and the run record may take at most ${mostResultBytes} bytes together;`,
  'an answer larger than that fails the run.',
  '`execution_id` is an optional UUID that identifies the run and controls retries as described below;',
  'without it, a new id is made, and the run answers with it.',
  'Once a run succeeded, or its input was rejected as invalid, a call with its id and the same definition',
  'and input runs nothing and answers the same again; so does a call with the id of a run',
  'that waits for work it started to end, answering it as it stands.',
  'Until then, a call with its id runs the definition again: after the server stopped during a run,',
  'after unavailable or a conflict its runtime adapter found, or after the run failed;',
  'but a run that called tools and did not succeed is never run again under its id,',
  'nor is a started run whose definition calls tools, which may still be in progress,',
  'since a tool may have changed something: inspect what it called with get_execution_history before choosing to start a new run with another id.',
  'Rejected with not_found when the type or definition is unavailable;',
  'with conflict when the definition is retired, when its document no longer parses, when its runtime adapter finds',
  'that the definition cannot run as written (update it, then try again), when the run id belongs',
  'to another definition or input, when the run called tools and did not succeed, or started and its definition calls tools,',
  'or when another call recorded on the same run at the same moment;',
  'with invalid_input when its runtime adapter rejects the input, with issues under /input;',
  'and with unavailable when a dependency cannot serve now, in which case try again later,',
  'unless its kind is tools_unfinished: tools were called, so try again only as a new run with another id.',
  'Rejections from the runtime adapter (invalid_input, unavailable, and the conflict it finds) are recorded on the run.',
];

export function defineExecuteSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  return known.publish(
    defineCommand('brain', {
      name: 'execute_spec',
      title: 'Run definition',
      description: known.describe(description),
      route: { method: 'POST', path: '/specs/{primitive}/{name}/execute' },
      reachesOutside: primitives.some(({ reachesOutside }) => reachesOutside),
      mayChangeOutside: primitives.some(({ mayChangeOutside }) => mayChangeOutside),
      inputSchema: Schema.Struct({
        primitive: known.field,
        name: SpecNameField,
        input: Schema.optionalKey(InputField),
        execution_id: Schema.optionalKey(ExecutionIdField),
      }),
      outputSchema: RunSchema,
      reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name, input = {}, execution_id: suppliedId }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        return yield* executeRequest(primitive, { primitive: primitive.name, name, input }, suppliedId);
      }),
      plainLanguage: runPlainLanguage(primitives),
    }),
  );
}
