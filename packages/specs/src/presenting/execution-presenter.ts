import type { Presenter } from '@beonauto/operations';

import { ExecutionEventSchema, type ExecutionEvent } from '../execution/execution-events.ts';
import type { ExecutionRejection } from '../execution/execution.ts';
import { jsonBytesOf } from '../execution/recorded-size.ts';
import { runBrokeDown, runCarriesOn, runFinished, runRejected, runStarted } from '../plain-language/event-words.ts';
import type { SpecWords } from '../plain-language/spec-words.ts';
import { cutAtCodePoint, issuesShown, mostCallerBytes, mostDetailBytes } from './event-data.ts';
import { eventPresenter, type Account } from './event-presenter.ts';

function rejectionShown(rejection: ExecutionRejection) {
  const detail = cutAtCodePoint(rejection.detail, mostDetailBytes);
  if (rejection.reason === 'invalid_input') {
    return { reason: rejection.reason, detail, ...issuesShown(rejection.issues) };
  }
  if (rejection.reason === 'conflict') {
    return { reason: rejection.reason, detail };
  }
  const { reason, kind, because } = rejection;
  return { reason, detail, ...(kind === undefined ? {} : { kind }), ...(because === undefined ? {} : { because }) };
}

function accountOf(words: SpecWords, event: ExecutionEvent, executionId: string): Account {
  const fact = { execution_id: executionId, by: cutAtCodePoint(event.by, mostCallerBytes) };
  if (event.type === 'execution_started') {
    const { primitive, name, spec_version, input } = event;
    return {
      summary: runStarted(words, primitive, name),
      data: { ...fact, primitive, name, spec_version, input_bytes: jsonBytesOf(input) },
    };
  }
  if (event.type === 'execution_deferred') {
    return { summary: runCarriesOn, data: { ...fact, record_bytes: jsonBytesOf(event.record) } };
  }
  if (event.type === 'execution_succeeded') {
    const sizes = { output_bytes: jsonBytesOf(event.output), record_bytes: jsonBytesOf(event.record) };
    return { summary: runFinished, data: { ...fact, ...sizes } };
  }
  if (event.type === 'execution_rejected') {
    return { summary: runRejected(event.rejection), data: { ...fact, ...rejectionShown(event.rejection) } };
  }
  return { summary: runBrokeDown, data: fact };
}

export function executionPresenter(words: SpecWords): Presenter {
  return eventPresenter<ExecutionEvent['type'], ExecutionEvent>({
    streamKind: 'executions',
    eventSchema: ExecutionEventSchema,
    publicNames: {
      execution_started: 'execution_started',
      execution_deferred: 'execution_deferred',
      execution_succeeded: 'execution_succeeded',
      execution_rejected: 'execution_rejected',
      execution_failed: 'execution_failed',
    },
    account: (event, executionId) => accountOf(words, event, executionId),
  });
}
