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

const ReasonField = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(mostReasonLength),
  refusingForbiddenCharacters,
  refusingBlankText,
).annotate({
  description: `Why the run is cancelled, in words the run's history keeps, 1 to ${mostReasonLength} characters`,
});

const description = [
  'Cancels a run that waits for work that finishes later, such as a workflow, at the request of the caller.',
  'The request is recorded on the run at once, on any server, and the run then ends as rejected with the reason cancelled',
  'and the kind requested, within a moment: a workflow stops its steps and cancels the runs its steps wait for, each of them',
  'with the kind parent_ended. `reason` is kept on the run and becomes the detail of its ending.',
  'It answers the run as it stands, still started; get_execution shows how it ended.',
  'Asking again before it ended records nothing more.',
  'Rejected with not_found when the brain has no run with that id;',
  'with conflict when the run has already ended,',
  'or when it runs within the call that started it, such as a reasoning or computation function,',
  'which no server can interrupt from outside: it ends when that call does.',
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
  const { state } = yield* (yield* BrainWriter).execute(
    executionStreamOf(id),
    executionDecider,
    { type: 'cancel', kind: 'requested', reason: reason ?? `Cancelled at the request of ${by}`, by, at },
    { causationId: null, correlationId },
  );
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
