import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { RunSchema } from '../execution/execution.ts';
import { runPlainLanguage } from '../plain-language/run-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { executeRequest } from './execution-running.ts';
import { ExecutionIdField, InputField, SpecNameField } from './spec-fields.ts';

const description = [
  'Runs a function or workflow with an input and records the run.',
  'A function answers its result; a workflow or an interaction function answers started with an execution_id unless it ends before its first wait, and get_execution shows how it ended.',
  "Use it to run a saved definition at the person's request; a workflow's steps call it the same way.",
  '`primitive` and `name` say which definition, `input` is the value it takes, as the input_schema get_spec shows,',
  'and `execution_id` is optional: give the same id to retry safely, since a run that ended or waits answers as it stands and one that failed runs again.',
  'A reasoning function that names tools may change something outside the brain, so a run of one that did not succeed is never run again under its id;',
  'get_execution_history shows what it called.',
].join(' ');

export function defineExecuteSpec(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  return known.publish(
    defineCommand('brain', {
      name: 'execute_spec',
      title: 'Run definition',
      description,
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
      reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name, input = {}, execution_id: suppliedId }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        return yield* executeRequest(primitives, primitive, { primitive: primitive.name, name, input }, suppliedId);
      }),
      plainLanguage: runPlainLanguage(primitives),
    }),
  );
}
