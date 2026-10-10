import { brainFactOf, publishedEventOf, type CloudEvent } from '@beonauto/definitions';
import { streamKindOf, type Context, type RecordedEvent } from '@beonauto/operations';

interface Emitter {
  readonly runId: string;
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

const runFacts: ReadonlySet<string> = new Set(['run_started', 'run_succeeded', 'run_rejected', 'run_failed']);

const definitionFacts: ReadonlySet<string> = new Set([
  'definition_created',
  'definition_updated',
  'definition_retired',
]);

function otherRun(correlation: string | null, runId: string): string | undefined {
  return correlation === null || correlation === runId ? undefined : correlation;
}

function emitterOf({ runId, definitionType, definitionName }: Context): Emitter | undefined {
  return runId === undefined || definitionType !== 'workflow' || definitionName === undefined
    ? undefined
    : { runId, workflow: definitionName };
}

function published(record: RecordedEvent): EventOfRecord {
  const publication = publishedEventOf(record);
  if (publication === undefined) {
    return 'unreadable';
  }
  const emitter = emitterOf(publication.context);
  return {
    event: publication.data.event,
    depth: publication.context.depth ?? 1,
    emitter,
    ownedBy: emitter === undefined ? [] : [emitter.workflow],
    topRun: emitter === undefined ? undefined : otherRun(record.correlationId, emitter.runId),
  };
}

function workflowsOfSubject(subject: string | undefined, type: string): readonly string[] {
  return subject?.startsWith(`${type}/`) === true ? [subject.slice(type.length + 1)] : [];
}

function fact(record: RecordedEvent, type: string): EventOfRecord {
  const event = brainFactOf(record);
  if (event === undefined) {
    return 'unreadable';
  }
  const depth = (record.context.depth ?? 0) + 1;
  if (!runFacts.has(record.type)) {
    return { event, depth, emitter: undefined, ownedBy: [], topRun: undefined };
  }
  const runId = record.stream.slice(record.stream.indexOf('/') + 1);
  return {
    event,
    depth,
    emitter: undefined,
    ownedBy: workflowsOfSubject(event.subject, type),
    topRun: otherRun(record.correlationId, runId),
  };
}

export function followedEventOf(record: RecordedEvent, type: string): EventOfRecord {
  const kind = streamKindOf(record.stream);
  if (kind === 'events' && record.type === 'event_published') {
    return published(record);
  }
  const isFact =
    (kind === 'runs' && runFacts.has(record.type)) || (kind === 'definitions' && definitionFacts.has(record.type));
  return isFact ? fact(record, type) : 'none';
}
