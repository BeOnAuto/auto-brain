import { defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { RunSchema } from '../execution/execution.ts';
import { runPlainLanguage } from '../plain-language/run-words.ts';
import { specWordsFor } from '../plain-language/spec-words.ts';
import { knownPrimitives } from '../primitive/known-primitives.ts';
import type { Primitive } from '../primitive/primitive.ts';
import { startVersionOnce } from './execution-running.ts';
import { ExecutionIdField, InputField, SpecNameField } from './spec-fields.ts';

const description = [
  'Starts a run of one version of a definition under a run id, once: when the brain has a run under that id,',
  'it answers that run as it stands and starts nothing. The workflow host calls it in the process for the runs',
  'that triggers start, as the brain itself, with their reaction depth, lineage and trigger in the request; no transport serves it.',
].join(' ');

export function defineStartVersion(primitives: readonly Primitive[]) {
  const known = knownPrimitives(primitives);
  const words = runPlainLanguage(primitives);
  const specWords = specWordsFor(primitives);
  return known.publish(
    defineCommand('brain', {
      name: 'start_definition_version',
      title: 'Start a version once',
      description,
      route: { method: 'POST', path: '/specs/{primitive}/{name}/start-once' },
      inputSchema: Schema.Struct({
        primitive: known.field,
        name: SpecNameField,
        version: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
        input: InputField,
        execution_id: ExecutionIdField,
      }),
      outputSchema: RunSchema,
      reasons: ['not_found', 'conflict', 'invalid_input', 'unavailable', 'cancelled', 'unanswered'],
      handle: Effect.fnUntraced(function* ({ primitive: primitiveName, name, version, input, execution_id: id }) {
        const primitive = yield* known.primitiveNamed(primitiveName);
        return yield* startVersionOnce(primitives, primitive, { primitive: primitive.name, name, version, input }, id);
      }),
      plainLanguage: {
        ...words,
        attempt: ({ primitive, name }) => `start ${specWords.named(primitive, name)} once, for what it reacts to`,
      },
    }),
  );
}
