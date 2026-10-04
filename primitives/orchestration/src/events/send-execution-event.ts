import { randomUUID } from 'node:crypto';

import { BrainContext, defineCommand, NotFound, quoted } from '@beonauto/operations';
import { getExecution } from '@beonauto/specs';
import { jsonBytesOf } from '@beonauto/workflow-engine/dsl/json';
import {
  mostReceivedEventBytes,
  mostReceivedEvents,
  mostWaitingEventBytes,
  mostWaitingEvents,
} from '@beonauto/workflow-engine/limits';
import { DateTime, Effect, Schema, SchemaTransformation } from 'effect';

import type { OrchestrationClient } from '../primitive/orchestration-client.ts';

const mostEventBytes = 262_144;

const mostNameLength = 256;

const mostTextLength = 1024;

const ExecutionIdField = Schema.String.annotate({
  description: 'The id of the execution of a workflow spec, a UUID in any case, kept in lowercase',
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

function text(most: number, description: string) {
  return Schema.String.check(Schema.isMaxLength(most)).annotate({
    description: `${description}, at most ${most} characters`,
  });
}

const EventFields = {
  type: text(mostNameLength, 'What happened, such as com.acme.approval.decided').check(Schema.isNonEmpty()),
  source: Schema.optionalKey(text(mostTextLength, 'Where the event comes from')),
  subject: Schema.optionalKey(text(mostTextLength, 'What the event is about')),
  data: Schema.optionalKey(Schema.Json.annotate({ description: 'The payload of the event, any JSON value' })),
};

const EventSchema = Schema.Struct({
  ...EventFields,
  id: Schema.optionalKey(
    text(
      mostNameLength,
      'An id of the event; an event is delivered to a workflow once per id. Made when left out',
    ).check(Schema.isNonEmpty()),
  ),
})
  .check(
    Schema.makeFilter((event: Schema.Json) => jsonBytesOf(event) <= mostEventBytes, {
      expected: `an event of at most ${mostEventBytes} bytes as JSON in UTF-8`,
    }),
  )
  .annotate({
    description: `An event for a workflow to listen to, after the CloudEvents attributes, at most ${mostEventBytes} bytes as JSON in UTF-8`,
  });

const DeliveredEventSchema = Schema.Struct({
  ...EventFields,
  id: Schema.String.annotate({ description: 'The id of the event' }),
  time: Schema.String.annotate({ description: 'When the event was sent, in ISO 8601 UTC' }),
}).annotate({ identifier: 'DeliveredEvent', description: 'The event as the workflow received it' });

export function defineSendExecutionEvent(client: OrchestrationClient) {
  return defineCommand('brain', {
    name: 'send_execution_event',
    title: 'Send execution event',
    description: [
      'Sends an event to the running workflow of an execution, for its listen tasks, and returns the event',
      'with its id and the time it was sent.',
      '`execution_id` names an execution of an orchestration spec that is still started.',
      `\`event\` has a \`type\` and an optional \`id\` (each at most ${mostNameLength} characters), \`source\` and`,
      `\`subject\` (each at most ${mostTextLength} characters) and \`data\` (any JSON value); the whole event takes at`,
      `most ${mostEventBytes} bytes as JSON.`,
      'A listen task consumes an event whose attributes match its filter; an event no task consumes yet waits',
      'in the workflow, and an event with an id the workflow already received is ignored, so a call can be',
      'retried safely with the same id.',
      `A workflow holds at most ${mostWaitingEvents} events it has not consumed (${mostWaitingEventBytes} bytes), and takes`,
      `at most ${mostReceivedEvents} events (${mostReceivedEventBytes} bytes as JSON) over its life; one more fails it, and`,
      'its execution settles rejected.',
      'Rejected with not_found when the brain has no running workflow execution with that id,',
      'and with unavailable when the workflow engine cannot be reached, in which case try again.',
    ].join(' '),
    route: { method: 'POST', path: '/executions/{execution_id}/events' },
    inputSchema: Schema.Struct({ execution_id: ExecutionIdField, event: EventSchema }),
    outputSchema: Schema.Struct({
      execution_id: Schema.String.annotate({ description: 'The id of the execution' }),
      event: DeliveredEventSchema,
    }),
    reasons: ['not_found', 'unavailable'],
    handle: Effect.fnUntraced(function* ({ execution_id: executionId, event }) {
      const execution = yield* getExecution.call({ execution_id: executionId });
      if (execution.primitive !== 'orchestration' || execution.status !== 'started') {
        return yield* new NotFound({ detail: 'The brain has no running workflow execution with that id' });
      }
      const { org, brain } = yield* BrainContext;
      const delivered = { ...event, id: event.id ?? randomUUID(), time: DateTime.formatIso(yield* DateTime.now) };
      yield* client.signal({ org, brain, spec: execution.name, executionId }, delivered);
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
