import { streamKindOf, type RecordedEvent } from '@beonauto/operations';
import { Option, Schema } from 'effect';

import {
  ExecutionEventSchema,
  type CalledBy,
  type ExecutionEvent,
  type ExecutionFinished,
  type ExecutionStarted,
} from '../execution/execution-events.ts';
import { jsonBytesOf, nestsWithin } from '../execution/recorded-size.ts';
import { SpecEventSchema, type SpecEvent } from '../registry/spec-events.ts';
import type { StartingTrigger } from '../registry/spec-triggers.ts';
import { mostEventDataDepth, mostPublishedEventBytes, type CloudEvent } from './cloud-event.ts';
import { EventPublishedSchema } from './published-events.ts';
import { runSourcePrefix, specSourcePrefix } from './reserved-attributes.ts';

type RunFact = ExecutionStarted | ExecutionFinished;

type RunData = {
  readonly primitive: string;
  readonly name: string;
  readonly version: number;
  readonly caller: string;
  readonly depth: number;
  readonly called_by?: CalledBy;
  readonly trigger?: StartingTrigger;
  readonly reason?: string;
  readonly kind?: string;
};

const runFactTypes: readonly RunFact['type'][] = [
  'execution_started',
  'execution_succeeded',
  'execution_rejected',
  'execution_failed',
];

const decodeExecutionEvent = Schema.decodeUnknownOption(Schema.toCodecJson(ExecutionEventSchema));

const decodeSpecEvent = Schema.decodeUnknownOption(Schema.toCodecJson(SpecEventSchema));

const decodePublished = Schema.decodeUnknownOption(Schema.toCodecJson(EventPublishedSchema));

const publishedEventsKind = 'events';

function isRunFact(event: ExecutionEvent): event is RunFact {
  return runFactTypes.some((type) => type === event.type);
}

function withOutput(fact: CloudEvent, data: RunData, output: Schema.Json): CloudEvent {
  const whole = { ...fact, data: { ...data, output } };
  return jsonBytesOf(whole) <= mostPublishedEventBytes && nestsWithin(whole.data, mostEventDataDepth)
    ? whole
    : { ...fact, data: { ...data, output_bytes: jsonBytesOf(output) } };
}

function rejectionOf(event: RunFact): Pick<RunData, 'reason' | 'kind'> {
  if (event.type !== 'execution_rejected') {
    return {};
  }
  const { rejection } = event;
  const kind = 'kind' in rejection ? rejection.kind : undefined;
  return kind === undefined ? { reason: rejection.reason } : { reason: rejection.reason, kind };
}

function runFactOf(id: string, execution: string, event: RunFact): CloudEvent {
  const { primitive, name, spec_version: version, by: caller, at: time, depth = 0, called_by: calledBy } = event;
  const { trigger } = event;
  const data: RunData = {
    primitive,
    name,
    version,
    caller,
    depth,
    ...(calledBy === undefined ? {} : { called_by: calledBy }),
    ...(trigger === undefined ? {} : { trigger }),
    ...rejectionOf(event),
  };
  const fact = {
    specversion: '1.0',
    id,
    source: `${runSourcePrefix}${execution}`,
    type: event.type,
    subject: `${primitive}/${name}`,
    time,
    data,
  } satisfies CloudEvent;
  return event.type === 'execution_succeeded' ? withOutput(fact, data, event.output) : fact;
}

function specFactOf(id: string, primitive: string, event: SpecEvent): CloudEvent {
  const { name, by: caller, at: time } = event;
  return {
    specversion: '1.0',
    id,
    source: `${specSourcePrefix}${primitive}/${name}`,
    type: event.type,
    time,
    data: { primitive, name, ...(event.type === 'spec_retired' ? {} : { version: event.version }), caller },
  };
}

function factOf({ id, stream, data }: RecordedEvent): CloudEvent | undefined {
  const kind = streamKindOf(stream);
  const named = stream.slice(kind.length + 1);
  if (kind === 'specs') {
    return Option.getOrUndefined(Option.map(decodeSpecEvent(data), (event) => specFactOf(id, named, event)));
  }
  const runFact = kind === 'executions' ? Option.filter(decodeExecutionEvent(data), isRunFact) : Option.none();
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
  return Option.getOrUndefined(Option.map(decodePublished(record.data), ({ event }) => event));
}
