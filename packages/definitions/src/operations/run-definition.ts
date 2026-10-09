import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import type { Capability } from '../capability/capability.ts';
import { knownCapabilities } from '../capability/known-capabilities.ts';
import { runPlainLanguage } from '../plain-language/run-words.ts';
import { RunSchema } from '../runs/run.ts';
import { RunIdInputField, InputField, DefinitionNameField } from './definition-fields.ts';
import { runRequest } from './run-requests.ts';

const description = [
  'Runs a function or workflow with an input and records the run.',
  'A function answers its result; a workflow or an interaction function answers started with a run_id unless it ends before its first wait, and get_run shows how it ended.',
  "Use it to run a saved definition at the person's request; a workflow's steps call it the same way.",
  '`type` and `name` say which definition, `input` is the value it takes, as the input_schema get_definition shows,',
  'and `run_id` is optional: give the same id to retry safely, since a run that ended or waits answers as it stands and one that failed runs again.',
  'A reasoning function that names tools may change something outside the brain, so a run of one that did not succeed is never run again under its id;',
  'get_run_history shows what it called.',
].join(' ');

export function defineRunDefinition(capabilities: readonly Capability[]) {
  const known = knownCapabilities(capabilities);
  return known.publish(
    defineCommand('brain', {
      name: 'run_definition',
      title: 'Run definition',
      description,
      route: { method: 'POST', path: '/definitions/{type}/{name}/run' },
      reachesOutside: capabilities.some(({ reachesOutside }) => reachesOutside),
      mayChangeOutside: capabilities.some(({ mayChangeOutside }) => mayChangeOutside),
      inputSchema: Schema.Struct({
        type: known.field,
        name: DefinitionNameField,
        input: Schema.optionalKey(InputField),
        run_id: Schema.optionalKey(RunIdInputField),
      }),
      outputSchema: RunSchema,
      reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
      handle: Effect.fnUntraced(function* ({ type, name, input = {}, run_id: suppliedId }) {
        const capability = yield* known.capabilityOfType(type);
        return yield* runRequest(
          capabilities,
          capability,
          { definition_type: capability.type, name, input },
          suppliedId,
        );
      }),
      plainLanguage: runPlainLanguage(capabilities),
    }),
  );
}
