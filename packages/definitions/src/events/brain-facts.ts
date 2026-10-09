import { streamKindOf, type RecordedEvent } from '@beonauto/operations';
import { Option, Schema } from 'effect';

import { DefinitionEventSchema, type DefinitionEvent } from '../registry/definition-events.ts';
import type { StartingTrigger } from '../registry/definition-triggers.ts';
import { jsonBytesOf, nestsWithin } from '../runs/recorded-size.ts';
import { RunEventSchema, type CalledBy, type RunEvent, type RunFinished, type RunStarted } from '../runs/run-events.ts';
import { mostEventDataDepth, mostPublishedEventBytes, type CloudEvent } from './cloud-event.ts';
import { EventPublishedSchema } from './published-events.ts';
import { runSourcePrefix, definitionSourcePrefix } from './reserved-attributes.ts';

type RunFact = RunStarted | RunFinished;

type RunData = {
  readonly definition_type: string;
  readonly name: string;
  readonly version: number;
  readonly caller: string;
  readonly depth: number;
  readonly called_by?: CalledBy;
  readonly trigger?: StartingTrigger;
  readonly reason?: string;
  readonly kind?: string;
};

const runFactTypes: readonly RunFact['type'][] = ['run_started', 'run_succeeded', 'run_rejected', 'run_failed'];

const decodeRunEvent = Schema.decodeUnknownOption(Schema.toCodecJson(RunEventSchema));

const decodeDefinitionEvent = Schema.decodeUnknownOption(Schema.toCodecJson(DefinitionEventSchema));

const decodePublished = Schema.decodeUnknownOption(Schema.toCodecJson(EventPublishedSchema));

const publishedEventsKind = 'events';

function isRunFact(event: RunEvent): event is RunFact {
  return runFactTypes.some((type) => type === event.type);
}

function withOutput(fact: CloudEvent, data: RunData, output: Schema.Json): CloudEvent {
  const whole = { ...fact, data: { ...data, output } };
  return jsonBytesOf(whole) <= mostPublishedEventBytes && nestsWithin(whole.data, mostEventDataDepth)
    ? whole
    : { ...fact, data: { ...data, output_bytes: jsonBytesOf(output) } };
}

function rejectionOf(event: RunFact): Pick<RunData, 'reason' | 'kind'> {
  if (event.type !== 'run_rejected') {
    return {};
  }
  const { rejection } = event;
  const kind = 'kind' in rejection ? rejection.kind : undefined;
  return kind === undefined ? { reason: rejection.reason } : { reason: rejection.reason, kind };
}

function runFactOf(id: string, run: string, event: RunFact): CloudEvent {
  const {
    definition_type: definitionType,
    name,
    definition_version: version,
    by: caller,
    at: time,
    depth = 0,
    called_by: calledBy,
  } = event;
  const { trigger } = event;
  const data: RunData = {
    definition_type: definitionType,
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
    source: `${runSourcePrefix}${run}`,
    type: event.type,
    subject: `${definitionType}/${name}`,
    time,
    data,
  } satisfies CloudEvent;
  return event.type === 'run_succeeded' ? withOutput(fact, data, event.output) : fact;
}

function definitionFactOf(id: string, definitionType: string, event: DefinitionEvent): CloudEvent {
  const { name, by: caller, at: time } = event;
  return {
    specversion: '1.0',
    id,
    source: `${definitionSourcePrefix}${definitionType}/${name}`,
    type: event.type,
    time,
    data: {
      definition_type: definitionType,
      name,
      ...(event.type === 'definition_retired' ? {} : { version: event.version }),
      caller,
    },
  };
}

function factOf({ id, stream, data }: RecordedEvent): CloudEvent | undefined {
  const kind = streamKindOf(stream);
  const named = stream.slice(kind.length + 1);
  if (kind === 'definitions') {
    return Option.getOrUndefined(
      Option.map(decodeDefinitionEvent(data), (event) => definitionFactOf(id, named, event)),
    );
  }
  const runFact = kind === 'runs' ? Option.filter(decodeRunEvent(data), isRunFact) : Option.none();
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
