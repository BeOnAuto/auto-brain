import { randomUUID } from 'node:crypto';

import { BrainContext, defineCommand, NotFound } from '@beonauto/operations';
import { getExecution } from '@beonauto/specs';
import { DateTime, Effect, Schema, SchemaTransformation } from 'effect';

import { jsonBytesOf } from '../dsl/json.ts';
import type { OrchestrationClient } from '../primitive/orchestration-client.ts';

const mostEventDataBytes = 262_144;

const ExecutionIdField = Schema.String.annotate({
  description: 'The id of the execution of a workflow spec, a UUID in any case, kept in lowercase',
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

const EventDataField = Schema.Json.annotate({
  description: `The payload of the event, any JSON value of at most ${mostEventDataBytes} bytes as JSON in UTF-8`,
}).check(
  Schema.makeFilter((data: Schema.Json) => jsonBytesOf(data) <= mostEventDataBytes, {
    expected: `event data of at most ${mostEventDataBytes} bytes as JSON in UTF-8`,
  }),
);

const EventFields = {
  type: Schema.NonEmptyString.annotate({ description: 'What happened, such as com.acme.approval.decided' }),
  source: Schema.optionalKey(Schema.String.annotate({ description: 'Where the event comes from' })),
  subject: Schema.optionalKey(Schema.String.annotate({ description: 'What the event is about' })),
  data: Schema.optionalKey(EventDataField),
};

const EventSchema = Schema.Struct({
  ...EventFields,
  id: Schema.optionalKey(
    Schema.NonEmptyString.annotate({
      description: 'An id of the event; an event is delivered to a workflow once per id. Made when left out',
    }),
  ),
}).annotate({ description: 'An event for a workflow to listen to, after the CloudEvents attributes' });

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
      '`event` has a `type`, and an optional `source`, `subject`, `data` (any JSON value, at most',
      `${mostEventDataBytes} bytes) and \`id\`.`,
      'A listen task consumes an event whose attributes match its filter; an event no task consumes yet waits',
      'in the workflow, and an event with an id the workflow already received is ignored, so a call can be',
      'retried safely with the same id.',
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
  });
}
