import type { Presenter } from '@beonauto/operations';
import { RunEventSchema, type InputReceipt, type RunEvent, type Step } from '@beonauto/workflow-engine';
import { Schema } from 'effect';

import { summaryOf } from './run-words.ts';

const mostStepsShown = 5;

const mostKeyBytes = 256;

const mostReferenceBytes = 256;

const runsKind = 'runs';

const decodeRunEvent = Schema.decodeUnknownSync(Schema.toCodecJson(RunEventSchema));

const utf8 = new TextEncoder();

function encodedBytesOf(character: string): number {
  return utf8.encode(JSON.stringify(character)).byteLength - 2;
}

export function cutAtCodePoint(text: string, mostBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const character of text) {
    bytes += encodedBytesOf(character);
    if (bytes > mostBytes) {
      return text.slice(0, end);
    }
    end += character.length;
  }
  return text;
}

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

function stepShown({ reference, run, outcome }: Step): Schema.JsonObject {
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
  publicNames: { input_applied: 'workflow_input_applied' },
  present: ({ id, stream, data }) => {
    const event = decodeRunEvent(data);
    const executionId = stream.slice(runsKind.length + 1);
    return {
      id,
      at: new Date(event.receipt.at).toISOString(),
      type: 'workflow_input_applied',
      summary: summaryOf(event),
      data: dataOf(event, executionId),
    };
  },
};
