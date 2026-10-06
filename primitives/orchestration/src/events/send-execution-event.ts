import { randomUUID } from 'node:crypto';

import { BrainContext, defineCommand, NotFound, quoted } from '@beonauto/operations';
import {
  getExecution,
  isWorkflowRun,
  refusingBlankText,
  refusingForbiddenCharacters,
  refusingTheBrainsOwnAttributes,
  reservedEventTypes,
  reservedSourcePrefixes,
} from '@beonauto/specs';
import {
  jsonBytesOf,
  measureOf,
  mostReceivedEventBytes,
  mostReceivedEvents,
  mostValueDepth,
  mostWaitingEventBytes,
  mostWaitingEvents,
} from '@beonauto/workflow-engine';
import type { WorkflowHost } from '@beonauto/workflow-host';
import { DateTime, Effect, Schema, SchemaTransformation } from 'effect';

import { unavailableUnless } from '../runs/host-refusals.ts';

const mostEventBytes = 262_144;

const mostNameLength = 256;

const mostTextLength = 1024;

const mostDataDepth = mostValueDepth - 2;

const noRunningWorkflow = 'The brain has no active workflow run with that id';

const notNow = 'The workflow cannot take the event now; try again shortly';

const ExecutionIdField = Schema.String.annotate({
  description: 'The id of the workflow run, a UUID in any case, kept in lowercase',
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

function text(most: number, description: string) {
  return Schema.String.check(Schema.isMaxLength(most), refusingForbiddenCharacters).annotate({
    description: `${description}, at most ${most} characters`,
  });
}

function wordedText(most: number, description: string) {
  return text(most, description).check(Schema.isNonEmpty(), refusingBlankText);
}

const EventFields = {
  type: wordedText(mostNameLength, 'What happened, such as com.acme.approval.decided'),
  source: Schema.optionalKey(text(mostTextLength, 'Where the event comes from')),
  subject: Schema.optionalKey(wordedText(mostTextLength, 'What the event is about')),
  data: Schema.optionalKey(
    Schema.Json.annotate({
      description: `The payload of the event, any JSON value that nests at most ${mostDataDepth} levels deep`,
    }).check(
      Schema.makeFilter((data: Schema.Json) => measureOf(data, mostDataDepth) !== undefined, {
        expected: `data that nests at most ${mostDataDepth} levels deep, so that the workflow can hold the event in a list`,
      }),
    ),
  ),
};

const EventSchema = Schema.Struct({
  ...EventFields,
  id: Schema.optionalKey(
    wordedText(
      mostNameLength,
      'An id of the event; an event is delivered to a workflow once per id. Made when left out',
    ),
  ),
})
  .check(
    Schema.makeFilter((event: Schema.Json) => jsonBytesOf(event) <= mostEventBytes, {
      expected: `an event of at most ${mostEventBytes} bytes as JSON in UTF-8`,
    }),
    refusingTheBrainsOwnAttributes,
  )
  .annotate({
    description: `An event for a workflow to listen to, after the CloudEvents attributes, at most ${mostEventBytes} bytes as JSON in UTF-8`,
  });

const DeliveredEventSchema = Schema.Struct({
  ...EventFields,
  id: Schema.String.annotate({ description: 'The id of the event' }),
  time: Schema.String.annotate({ description: 'When the event was sent, in ISO 8601 UTC' }),
}).annotate({ identifier: 'DeliveredEvent', description: 'The event as the workflow received it' });

const description = [
  'Sends an event to an existing workflow run, for its listen steps, and returns the event',
  'with its id and the time it was sent.',
  '`execution_id` names the workflow run that is still started. This resumes waiting work; it does not start a new run.',
  `\`event\` has a \`type\` and an optional \`id\` (each at most ${mostNameLength} characters), \`source\` and`,
  `\`subject\` (each at most ${mostTextLength} characters; no text may hold a control character, a lone surrogate or a`,
  'noncharacter, and type, id and subject need a character that is not a space) and `data` (any JSON value that nests at most',
  `${mostDataDepth} levels deep); the whole event takes at most ${mostEventBytes} bytes as JSON.`,
  'A listen task consumes an event whose attributes match its filter; an event no task consumes yet waits',
  'in the workflow, and an event with an id the workflow already received is ignored, so a call can be',
  'retried safely with the same id.',
  `The types ${[...reservedEventTypes].join(', ')} and sources under ${reservedSourcePrefixes.join(' or ')}`,
  "are the brain's own, for what it records itself, and are refused with invalid_input.",
  `A workflow holds at most ${mostWaitingEvents} events it has not consumed (${mostWaitingEventBytes} bytes), and takes`,
  `at most ${mostReceivedEvents} events (${mostReceivedEventBytes} bytes as JSON) over its life; one more fails it, and`,
  'its run settles rejected.',
  'Rejected with not_found when the brain has no active workflow run with that id,',
  'and with unavailable when the workflow cannot take the event at that moment, in which case try again.',
].join(' ');

export function defineSendExecutionEvent(runs: Pick<WorkflowHost, 'deliver'>) {
  return defineCommand('brain', {
    name: 'send_execution_event',
    title: 'Send event to workflow run',
    description,
    route: { method: 'POST', path: '/executions/{execution_id}/events' },
    inputSchema: Schema.Struct({ execution_id: ExecutionIdField, event: EventSchema }),
    outputSchema: Schema.Struct({
      execution_id: Schema.String.annotate({ description: 'The id of the workflow run' }),
      event: DeliveredEventSchema,
    }),
    reasons: ['not_found', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ execution_id: executionId, event }) {
      const execution = yield* getExecution.call({ execution_id: executionId });
      if (!isWorkflowRun(execution) || execution.status !== 'started') {
        return yield* new NotFound({ detail: noRunningWorkflow });
      }
      const { org, brain } = yield* BrainContext;
      const delivered = { ...event, id: event.id ?? randomUUID(), time: DateTime.formatIso(yield* DateTime.now) };
      const answer = yield* runs
        .deliver({ org, brain, executionId }, delivered)
        .pipe(Effect.mapError(unavailableUnless(notNow)));
      if (answer !== 'delivered') {
        return yield* new NotFound({ detail: noRunningWorkflow });
      }
      return { execution_id: executionId, event: delivered };
    }),
    plainLanguage: {
      task: 'send an event to a running workflow',
      attempt: ({ event }) => `send the event ${quoted(event.type)} to a running workflow`,
      outcome: ({ event }) =>
        `Delivered the event ${quoted(event.type)} to the running workflow. The workflow uses it as soon as it is waiting for it.`,
    },
  });
}
