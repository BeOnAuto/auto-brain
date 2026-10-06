import { streamKindOf, type RecordedEvent } from '@beonauto/operations';
import { Schema } from 'effect';

import {
  ExecutionEventSchema,
  type ExecutionEvent,
  type ExecutionFinished,
  type ExecutionStarted,
} from '../execution/execution-events.ts';
import { jsonBytesOf } from '../execution/recorded-size.ts';
import { SpecEventSchema, type SpecEvent } from '../registry/spec-events.ts';
import { mostPublishedEventBytes, type CloudEvent } from './cloud-event.ts';

type RunFact = ExecutionStarted | ExecutionFinished;

type RunData = {
  readonly primitive: string;
  readonly name: string;
  readonly version: number;
  readonly caller: string;
};

const runFactTypes: readonly RunFact['type'][] = [
  'execution_started',
  'execution_succeeded',
  'execution_rejected',
  'execution_failed',
];

const specFactTypes: readonly SpecEvent['type'][] = ['spec_created', 'spec_updated', 'spec_retired'];

export const reservedEventTypes: ReadonlySet<string> = new Set([...runFactTypes, ...specFactTypes]);

const runSource = '/executions/';

const specSource = '/specs/';

export const reservedSourcePrefixes: readonly string[] = [runSource, specSource];

const decodeExecutionEvent = Schema.decodeUnknownSync(Schema.toCodecJson(ExecutionEventSchema));

const decodeSpecEvent = Schema.decodeUnknownSync(Schema.toCodecJson(SpecEventSchema));

export function isReservedSource(source: string): boolean {
  return reservedSourcePrefixes.some((prefix) => source.startsWith(prefix));
}

function isRunFact(event: ExecutionEvent): event is RunFact {
  return runFactTypes.some((type) => type === event.type);
}

function withOutput(fact: CloudEvent, data: RunData, output: Schema.Json): CloudEvent {
  const whole = { ...fact, data: { ...data, output } };
  return jsonBytesOf(whole) <= mostPublishedEventBytes
    ? whole
    : { ...fact, data: { ...data, output_bytes: jsonBytesOf(output) } };
}

function runFactOf(id: string, execution: string, event: RunFact): CloudEvent {
  const { primitive, name, spec_version: version, by: caller, at: time } = event;
  const data: RunData = { primitive, name, version, caller };
  const fact = {
    specversion: '1.0',
    id,
    source: `${runSource}${execution}`,
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
    source: `${specSource}${primitive}/${name}`,
    type: event.type,
    time,
    data: { primitive, name, ...(event.type === 'spec_retired' ? {} : { version: event.version }), caller },
  };
}

export function brainFactOf({ id, stream, data }: RecordedEvent): CloudEvent | undefined {
  const kind = streamKindOf(stream);
  const named = stream.slice(kind.length + 1);
  if (kind === 'specs') {
    return specFactOf(id, named, decodeSpecEvent(data));
  }
  if (kind !== 'executions') {
    return undefined;
  }
  const event = decodeExecutionEvent(data);
  return isRunFact(event) ? runFactOf(id, named, event) : undefined;
}
