import {
  CancelledKindSchema,
  ConflictKindSchema,
  UnavailableBecauseSchema,
  UnavailableKindSchema,
  type RecordedEvent,
} from '@beonauto/operations';
import { Effect, Schema, Struct } from 'effect';

import { executionDecider, executionStreamOf } from '../execution/execution-decider.ts';
import { ExecutionEventSchema, type ExecutionEvent } from '../execution/execution-events.ts';
import { executionOf } from '../execution/execution-lookup.ts';
import { evolveExecution, type ExecutionState } from '../execution/execution-state.ts';
import { RunSchema, type Run, type ExecutionRejection } from '../execution/execution.ts';

const ListedRejectionSchema = Schema.Struct({
  reason: Schema.Literals(['invalid_input', 'unavailable', 'conflict', 'cancelled']),
  kind: Schema.optionalKey(Schema.Union([UnavailableKindSchema, ConflictKindSchema, CancelledKindSchema])),
  because: Schema.optionalKey(UnavailableBecauseSchema),
}).annotate({
  description:
    'Why the run was rejected: its reason, the kind it gave for unavailable or conflict, the kind of a cancellation, and for unavailable the because it gave',
});

export const ListedRunSchema = Schema.Struct({
  ...Struct.omit(RunSchema.fields, ['output', 'rejection']),
  rejection: Schema.optionalKey(ListedRejectionSchema),
}).annotate({
  identifier: 'ListedRun',
  description: 'One run of a definition and how it ended, without its output, its record and the detail of a rejection',
});

export type ListedRun = typeof ListedRunSchema.Type;

type ListedRejection = NonNullable<ListedRun['rejection']>;

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
  if (rejection.reason === 'invalid_input') {
    return { reason: rejection.reason };
  }
  if (rejection.reason === 'conflict') {
    const { reason, kind } = rejection;
    return { reason, ...(kind === undefined ? {} : { kind }) };
  }
  if (rejection.reason === 'cancelled') {
    const { reason, kind } = rejection;
    return { reason, kind };
  }
  const { reason, kind, because } = rejection;
  return { reason, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
}

function listedOf(execution: Run): ListedRun {
  const listed = Struct.omit(execution, ['output', 'rejection']);
  return execution.rejection === undefined ? listed : { ...listed, rejection: listedRejectionOf(execution.rejection) };
}

function listedExecutionOf(stream: string, heads: readonly RecordedEvent[]): Effect.Effect<ListedRun> {
  return Effect.forEach(heads, ({ data }) => decodeEvent(data)).pipe(
    Effect.map((events: readonly ExecutionEvent[]) =>
      events.reduce((state: ExecutionState, event) => evolveExecution(state, event), executionDecider.initialState),
    ),
    Effect.flatMap((state) => executionOf(stream.slice(executionStreamPrefix.length), state)),
    Effect.orDie,
    Effect.map(listedOf),
  );
}

export function listedExecutionsOf(records: readonly RecordedEvent[]): Effect.Effect<readonly ListedRun[]> {
  return Effect.forEach(runsOf(records), ([stream, heads]: readonly [string, readonly RecordedEvent[]]) =>
    listedExecutionOf(stream, heads),
  );
}
