import { streamKindOf, type RecordedEvent } from '@beonauto/operations';
import { brainFactOf, publishedEventOf, type CloudEvent, type EventPublished } from '@beonauto/specs';
import { Option, Schema } from 'effect';

interface Emitter {
  readonly executionId: string;
  readonly workflow: string;
}

export interface FollowedEvent {
  readonly event: CloudEvent;
  readonly depth: number;
  readonly emitter: Emitter | undefined;
  readonly ownedBy: readonly string[];
  readonly topRun: string | undefined;
}

export type EventOfRecord = FollowedEvent | 'none' | 'unreadable';

const runFacts: ReadonlySet<string> = new Set([
  'execution_started',
  'execution_succeeded',
  'execution_rejected',
  'execution_failed',
]);

const specFacts: ReadonlySet<string> = new Set(['spec_created', 'spec_updated', 'spec_retired']);

const decodeDepth = Schema.decodeUnknownOption(Schema.Struct({ depth: Schema.Int }));

function otherRun(correlation: string | null, executionId: string): string | undefined {
  return correlation === null || correlation === executionId ? undefined : correlation;
}

function emitterOf(publication: EventPublished): Emitter | undefined {
  const emitted = publication.emitted_by;
  return emitted === undefined ? undefined : { executionId: emitted.execution_id, workflow: emitted.workflow };
}

function published(record: RecordedEvent): EventOfRecord {
  const publication = publishedEventOf(record.data);
  if (publication === undefined) {
    return 'unreadable';
  }
  const emitter = emitterOf(publication);
  return {
    event: publication.event,
    depth: publication.depth ?? 1,
    emitter,
    ownedBy: emitter === undefined ? [] : [emitter.workflow],
    topRun: emitter === undefined ? undefined : otherRun(record.correlationId, emitter.executionId),
  };
}

function workflowsOfSubject(subject: string | undefined, primitive: string): readonly string[] {
  return subject?.startsWith(`${primitive}/`) === true ? [subject.slice(primitive.length + 1)] : [];
}

function depthOf(data: unknown): number {
  return Option.getOrElse(
    Option.map(decodeDepth(data), ({ depth }) => depth),
    () => 0,
  );
}

function fact(record: RecordedEvent, primitive: string): EventOfRecord {
  const event = brainFactOf(record);
  if (event === undefined) {
    return 'unreadable';
  }
  const depth = depthOf(event.data) + 1;
  if (!runFacts.has(record.type)) {
    return { event, depth, emitter: undefined, ownedBy: [], topRun: undefined };
  }
  const executionId = record.stream.slice(record.stream.indexOf('/') + 1);
  return {
    event,
    depth,
    emitter: undefined,
    ownedBy: workflowsOfSubject(event.subject, primitive),
    topRun: otherRun(record.correlationId, executionId),
  };
}

export function followedEventOf(record: RecordedEvent, primitive: string): EventOfRecord {
  const kind = streamKindOf(record.stream);
  if (kind === 'events' && record.type === 'event_published') {
    return published(record);
  }
  const isFact =
    (kind === 'executions' && runFacts.has(record.type)) || (kind === 'specs' && specFacts.has(record.type));
  return isFact ? fact(record, primitive) : 'none';
}
