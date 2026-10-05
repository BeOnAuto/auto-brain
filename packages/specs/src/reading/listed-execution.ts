import { UnavailableBecauseSchema, UnavailableKindSchema, type RecordedEvent } from '@beonauto/operations';
import { Effect, Schema, Struct } from 'effect';

import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import { ExecutionEventSchema, type ExecutionEvent } from '../execution/execution-events.ts';
import { executionOf } from '../execution/execution-lookup.ts';
import { evolveExecution, type ExecutionState } from '../execution/execution-state.ts';
import { ExecutionSchema, type Execution, type ExecutionRejection } from '../execution/execution.ts';

const ListedRejectionSchema = Schema.Struct({
  reason: Schema.Literals(['invalid_input', 'unavailable', 'conflict']),
  kind: Schema.optionalKey(UnavailableKindSchema),
  because: Schema.optionalKey(UnavailableBecauseSchema),
}).annotate({
  description: 'Why the primitive rejected the execution: its reason, and for unavailable the kind and because it gave',
});

export const ListedExecutionSchema = Schema.Struct({
  ...Struct.omit(ExecutionSchema.fields, ['output', 'rejection']),
  rejection: Schema.optionalKey(ListedRejectionSchema),
}).annotate({
  identifier: 'ListedExecution',
  description: 'One run of a spec and how it ended, without its output, its record and the detail of a rejection',
});

export type ListedExecution = typeof ListedExecutionSchema.Type;

type ListedRejection = NonNullable<ListedExecution['rejection']>;

const decodeEvent = Schema.decodeUnknownEffect(Schema.toCodecJson(ExecutionEventSchema));

const executionStreamPrefix = executionStreamOf('');

function runsOf(records: readonly RecordedEvent[]): ReadonlyMap<string, readonly RecordedEvent[]> {
  const runs = new Map<string, readonly RecordedEvent[]>();
  for (const record of records) {
    runs.set(record.stream, [...(runs.get(record.stream) ?? []), record]);
  }
  return runs;
}

function listedRejectionOf(rejection: ExecutionRejection): ListedRejection {
  if (rejection.reason !== 'unavailable') {
    return { reason: rejection.reason };
  }
  const { reason, kind, because } = rejection;
  return { reason, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
}

function listedOf(execution: Execution): ListedExecution {
  const listed = Struct.omit(execution, ['output', 'rejection']);
  return execution.rejection === undefined ? listed : { ...listed, rejection: listedRejectionOf(execution.rejection) };
}

function listedExecutionOf(stream: string, heads: readonly RecordedEvent[]): Effect.Effect<ListedExecution> {
  return Effect.forEach(heads, ({ data }) => decodeEvent(data)).pipe(
    Effect.map((events: readonly ExecutionEvent[]) =>
      events.reduce((state: ExecutionState, event) => evolveExecution(state, event), executionDecider.initialState),
    ),
    Effect.flatMap((state) => executionOf(stream.slice(executionStreamPrefix.length), state)),
    Effect.orDie,
    Effect.map(listedOf),
  );
}

export function listedExecutionsOf(records: readonly RecordedEvent[]): Effect.Effect<readonly ListedExecution[]> {
  return Effect.forEach(runsOf(records), ([stream, heads]: readonly [string, readonly RecordedEvent[]]) =>
    listedExecutionOf(stream, heads),
  );
}
