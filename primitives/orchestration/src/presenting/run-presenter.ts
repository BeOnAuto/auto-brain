import type { Presenter } from '@beonauto/operations';
import {
  RunEventSchema,
  type EarlierStep,
  type InputReceipt,
  type RunEvent,
  type Step,
} from '@beonauto/workflow-engine';
import { Schema } from 'effect';

import { cutAtCodePoint } from './cut-text.ts';
import { summaryOf } from './run-words.ts';
import { stepEventsOf, stepEventTypes } from './step-events.ts';

const mostStepsShown = 5;

const mostKeyBytes = 256;

const mostReferenceBytes = 256;

const runsKind = 'runs';

const decodeRunEvent = Schema.decodeUnknownSync(Schema.toCodecJson(RunEventSchema));

type Rejection = NonNullable<Extract<InputReceipt, { readonly kind: 'call_answered' }>['rejection']>;

function rejectionShown({ kind, because }: Rejection): Schema.JsonObject {
  return {
    ...(kind === undefined ? {} : { kind: cutAtCodePoint(kind, mostKeyBytes) }),
    ...(because === undefined ? {} : { because: cutAtCodePoint(because, mostKeyBytes) }),
  };
}

function inputShown(receipt: InputReceipt, executionId: string): Schema.JsonObject {
  if (receipt.kind === 'call_answered') {
    const { rejection } = receipt;
    return {
      kind: receipt.kind,
      key: cutAtCodePoint(receipt.key, mostKeyBytes),
      status: receipt.status,
      ...(rejection === undefined ? {} : { rejection: rejectionShown(rejection) }),
    };
  }
  if (receipt.kind === 'event_received') {
    return {
      kind: receipt.kind,
      key: cutAtCodePoint(receipt.key, mostKeyBytes),
      event_type: cutAtCodePoint(receipt.eventType, mostKeyBytes),
    };
  }
  return { kind: receipt.kind, key: receipt.kind === 'timer_fired' ? receipt.key : executionId };
}

function stepShown({ reference, run, outcome }: Step | EarlierStep): Schema.JsonObject {
  return { task: cutAtCodePoint(reference, mostReferenceBytes), run, outcome };
}

function dataOf({ receipt, steps, outputs }: RunEvent, executionId: string): Schema.JsonObject {
  return {
    execution_id: executionId,
    input: inputShown(receipt, executionId),
    step_count: steps.length,
    steps: steps.slice(0, mostStepsShown).map((step) => stepShown(step)),
    output_kinds: [...new Set(outputs.map(({ kind }) => kind))],
  };
}

export const runPresenter: Presenter = {
  streamKind: runsKind,
  publicNames: { input_applied: ['workflow_input_applied', ...stepEventTypes] },
  present: (recorded) => {
    const event = decodeRunEvent(recorded.data);
    const executionId = recorded.stream.slice(runsKind.length + 1);
    const record = {
      id: recorded.id,
      cursor: recorded.cursor,
      causation_id: recorded.causationId,
      at: new Date(event.receipt.at).toISOString(),
      type: 'workflow_input_applied',
      summary: summaryOf(event),
      data: dataOf(event, executionId),
    };
    return [record, ...stepEventsOf(recorded, event, executionId)];
  },
};
