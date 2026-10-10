import { recordedDecoder, streamKindOf, type Context, type Recorded, type RecordedEvent } from '@beonauto/operations';
import { Option, type Schema } from 'effect';

import { DefinitionEventSchema, type DefinitionEvent } from '../registry/definition-events.ts';
import { definitionNameOf } from '../registry/definition-registry.ts';
import { jsonBytesOf, nestsWithin } from '../runs/recorded-size.ts';
import { RunEventSchema, type RunEvent, type RunFinished, type RunStarted } from '../runs/run-events.ts';
import type { RunRejection } from '../runs/run.ts';
import { mostEventDataDepth, mostPublishedEventBytes, type CloudEvent } from './cloud-event.ts';
import { EventPublishedSchema } from './published-events.ts';
import { runSourcePrefix, definitionSourcePrefix } from './reserved-attributes.ts';

type RunFact = RunStarted | RunFinished;

type Extensions = Readonly<Record<string, string | number>>;

const runFactTypes: readonly RunFact['type'][] = ['run_started', 'run_succeeded', 'run_rejected', 'run_failed'];

const decodeRunEvent = recordedDecoder(RunEventSchema);

const decodeDefinitionEvent = recordedDecoder(DefinitionEventSchema);

const decodePublished = recordedDecoder(EventPublishedSchema);

const publishedEventsKind = 'events';

function isRunFact(event: Recorded<RunEvent>): event is Recorded<RunFact> {
  return runFactTypes.some((type) => type === event.type);
}

function triggerOf({ trigger }: Context): Extensions {
  return trigger === undefined ? {} : { triggerkind: trigger.kind, triggerreference: trigger.reference };
}

function extensionsOf(context: Context): Extensions {
  const { by, definitionVersion, depth, callDepth, calledBy } = context;
  return {
    caller: by,
    ...(definitionVersion === undefined ? {} : { definitionversion: definitionVersion }),
    ...(depth === undefined ? {} : { depth }),
    ...(callDepth === undefined ? {} : { calldepth: callDepth }),
    ...(calledBy === undefined ? {} : { calledby: calledBy.runId }),
    ...triggerOf(context),
  };
}

function subjectOf({ definitionType, definitionName }: Context): { readonly subject?: string } {
  return definitionType === undefined || definitionName === undefined
    ? {}
    : { subject: `${definitionType}/${definitionName}` };
}

function withOutput(fact: CloudEvent, output: Schema.Json): CloudEvent {
  const whole = { ...fact, data: { output } };
  return jsonBytesOf(whole) <= mostPublishedEventBytes && nestsWithin(whole.data, mostEventDataDepth)
    ? whole
    : { ...fact, data: { output_bytes: jsonBytesOf(output) } };
}

function rejectionOf(rejection: RunRejection): Schema.JsonObject {
  const kind = 'kind' in rejection ? rejection.kind : undefined;
  return kind === undefined ? { reason: rejection.reason } : { reason: rejection.reason, kind };
}

function runFactOf(id: string, run: string, event: Recorded<RunFact>): CloudEvent {
  const { context } = event;
  const fact: CloudEvent = {
    specversion: '1.0',
    id,
    source: `${runSourcePrefix}${run}`,
    type: event.type,
    ...subjectOf(context),
    time: context.at,
    ...extensionsOf(context),
  };
  if (event.type === 'run_succeeded') {
    return withOutput(fact, event.data.output);
  }
  return event.type === 'run_rejected' ? { ...fact, data: rejectionOf(event.data.rejection) } : fact;
}

function definitionFactOf(
  id: string,
  definitionType: string,
  { type, context }: Recorded<DefinitionEvent>,
): CloudEvent {
  return {
    specversion: '1.0',
    id,
    source: `${definitionSourcePrefix}${definitionType}/${definitionNameOf(context)}`,
    type,
    time: context.at,
    ...extensionsOf(context),
  };
}

function factOf(record: RecordedEvent): CloudEvent | undefined {
  const { id, stream } = record;
  const kind = streamKindOf(stream);
  const named = stream.slice(kind.length + 1);
  if (kind === 'definitions') {
    return Option.getOrUndefined(
      Option.map(decodeDefinitionEvent(record), (event) => definitionFactOf(id, named, event)),
    );
  }
  const runFact = kind === 'runs' ? Option.filter(decodeRunEvent(record), isRunFact) : Option.none();
  return Option.getOrUndefined(Option.map(runFact, (event) => runFactOf(id, named, event)));
}

function lineageOf({ causationId, correlationId }: RecordedEvent): Readonly<Record<string, string>> {
  return {
    ...(causationId === null ? {} : { causationid: causationId }),
    ...(correlationId === null ? {} : { correlationid: correlationId }),
  };
}

export function brainFactOf(record: RecordedEvent): CloudEvent | undefined {
  const fact = factOf(record);
  return fact === undefined ? undefined : { ...fact, ...lineageOf(record) };
}

export function brainEventOf(record: RecordedEvent): CloudEvent | undefined {
  if (streamKindOf(record.stream) !== publishedEventsKind || record.type !== 'event_published') {
    return brainFactOf(record);
  }
  return Option.getOrUndefined(Option.map(decodePublished(record), ({ data }) => data.event));
}
