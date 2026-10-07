import { BrainReader, BrainWriter, capitalized, defineCommand } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { refusingBlankText, refusingForbiddenCharacters } from '../events/cloud-event.ts';
import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import { executionOf } from '../execution/execution-lookup.ts';
import { RunSchema, type Run } from '../execution/execution.ts';
import { commandMetadata } from '../operations/command-metadata.ts';
import { ExecutionIdField } from '../operations/spec-fields.ts';
import { specWordsFor } from '../plain-language/spec-words.ts';
import type { Primitive } from '../primitive/primitive.ts';

const mostReasonLength = 1024;

const ReasonField = Schema.String.annotate({
  description: `Why the run is cancelled, in words the run's history keeps, 1 to ${mostReasonLength} characters`,
}).check(Schema.isMinLength(1), Schema.isMaxLength(mostReasonLength), refusingForbiddenCharacters, refusingBlankText);

const description = [
  'Cancels a run that is still going and finishes later, such as a workflow, at the request of the person:',
  "the request is recorded on the run at once, and the run ends as cancelled within a moment, its workflow's steps stopped and the runs they wait for cancelled too.",
  'It cannot be undone, and what the run did before it ended stays done.',
  'Use it only when the person asks to stop that run; a reasoning or computation function runs within its call and cannot be cancelled.',
  "`execution_id` is the run's id and `reason`, kept on the run, says why; asking again records nothing more, and get_execution shows how it ended.",
].join(' ');

const correlationOf = Effect.fnUntraced(function* (id: string) {
  const { records } = yield* (yield* BrainReader).readRecorded(
    { kind: 'run', execution: id },
    { order: 'asc', limit: 1, dataOf: [] },
  );
  return records[0]?.correlationId ?? id;
});

const cancelled = Effect.fnUntraced(function* (id: string, reason: string | undefined) {
  const { by, at } = yield* commandMetadata;
  const correlationId = yield* Effect.orDie(correlationOf(id));
  const { state } = yield* (yield* BrainWriter)
    .execute(
      executionStreamOf(id),
      executionDecider,
      { type: 'cancel', kind: 'requested', reason: reason ?? `Cancelled at the request of ${by}`, by, at },
      { causationId: null, correlationId },
    )
    .pipe(Effect.catchTag('cancelled', Effect.die));
  return yield* executionOf(id, state);
});

export function defineCancelExecution(primitives: readonly Primitive[]) {
  const words = specWordsFor(primitives);
  const cancelling = ({ primitive, name }: Pick<Run, 'primitive' | 'name'>) =>
    `${capitalized(words.named(primitive, name))} is being cancelled: it ends as cancelled within a moment, unless it finishes first, and how it ended can be looked up then.`;
  return defineCommand('brain', {
    name: 'cancel_execution',
    title: 'Cancel run',
    description,
    route: { method: 'POST', path: '/executions/{execution_id}/cancel' },
    irreversible: true,
    repeatable: true,
    inputSchema: Schema.Struct({ execution_id: ExecutionIdField, reason: Schema.optionalKey(ReasonField) }),
    outputSchema: RunSchema,
    reasons: ['not_found', 'conflict'],
    handle: ({ execution_id: id, reason }) => cancelled(id, reason),
    plainLanguage: {
      task: 'cancel a run',
      attempt: () => 'cancel the run',
      outcome: cancelling,
    },
  });
}
