import { cursorWithin, type PublicEvent, type RecordedEvent } from '@beonauto/operations';
import { isRecordedStep, keyOf, stepEventIdOf, type RunLogEvent, type Step } from '@beonauto/workflow-engine';
import type { Schema } from 'effect';

import { cutAtCodePoint } from './cut-text.ts';
import { stepSummaryOf } from './run-words.ts';

const mostReferenceBytes = 256;

const mostErrorTypeBytes = 256;

const mostErrorTitleBytes = 1024;

const publicTypes: Readonly<Record<Step['outcome'], string>> = {
  started: 'step_started',
  waiting: 'step_waiting',
  completed: 'step_finished',
  raised: 'step_failed',
  timed_out: 'step_failed',
  cancelled: 'step_failed',
  skipped: 'step_skipped',
};

export const stepEventTypes: readonly string[] = [...new Set(Object.values(publicTypes))];

interface ErrorShown {
  readonly error?: { readonly type: string; readonly title?: string };
}

function errorShown(error: Step['error']): ErrorShown {
  if (error === undefined) {
    return {};
  }
  const type = cutAtCodePoint(error.type, mostErrorTypeBytes);
  return {
    error: error.title === undefined ? { type } : { type, title: cutAtCodePoint(error.title, mostErrorTitleBytes) },
  };
}

function dataOf({ name, reference, run, times, outcome, error, waits_for: waitsFor, child }: Step): Schema.JsonObject {
  const shown = {
    name,
    reference: cutAtCodePoint(reference, mostReferenceBytes),
    run,
    times,
    ...(waitsFor === undefined ? {} : { waits_for: waitsFor }),
    ...(child === undefined ? {} : { run_id: child }),
  };
  return publicTypes[outcome] === 'step_failed' ? { ...shown, outcome, ...errorShown(error) } : shown;
}

export function stepEventsOf(recorded: RecordedEvent, event: RunLogEvent, runId: string): readonly PublicEvent[] {
  const at = new Date(event.receipt.at).toISOString();
  return event.steps
    .filter((step) => isRecordedStep(step))
    .map((step, index) => ({
      id: stepEventIdOf(runId, keyOf(step)),
      cursor: cursorWithin(recorded.cursor, index + 1),
      causation_id: step.caused_by === 'input' ? recorded.id : stepEventIdOf(runId, step.caused_by),
      at,
      type: publicTypes[step.outcome],
      summary: stepSummaryOf(step),
      data: dataOf(step),
    }));
}
