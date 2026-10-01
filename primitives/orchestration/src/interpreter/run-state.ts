import { isJson, isObject, measureOf, mostValueDepth, objectField, type Json, type JsonObject } from '../dsl/json.ts';
import type { Components } from '../dsl/policy-checks.ts';
import type { WorkflowHost } from './host.ts';
import { raised } from './raised-error.ts';
import type { WorkflowRun } from './workflow-run.ts';

export type EventFilter = (event: JsonObject) => boolean;

export interface Meter {
  readonly allowance: () => number;
  readonly record: (work: number) => void;
  readonly shouldYield: () => boolean;
  readonly countTask: () => void;
}

export interface RunState {
  readonly run: WorkflowRun;
  readonly host: WorkflowHost;
  readonly meter: Meter;
  readonly components: Components;
  readonly workflow: JsonObject;
  readonly context: () => Json;
  readonly replaceContext: (next: Json) => void;
  readonly nextRun: (reference: string) => number;
  readonly step: (reference: string) => void;
  readonly checkHistory: (reference: string) => void;
  readonly beforeWaiting: (reference: string) => void;
  readonly deliver: (event: unknown) => void;
  readonly eventsDelivered: () => number;
  readonly takeEvent: (accepts: EventFilter) => JsonObject | undefined;
}

export const runtimeDescriptor: JsonObject = {
  name: 'auto-brain',
  version: '1',
  metadata: { primitive: 'orchestration' },
};

export const mostHistoryBytes = 41_943_040;

export const mostHistoryEvents = 40_000;

export const mostStepsWithoutWaiting = 10_000;

export const mostExpressionWork = 8_000_000;

export const mostActivationWork = 16_000_000;

const mostTasksPerActivation = 100;

const mostValueWork = mostExpressionWork;

export function dateTimeOf(milliseconds: number): JsonObject {
  return {
    iso8601: new Date(milliseconds).toISOString(),
    epoch: { seconds: Math.floor(milliseconds / 1000), milliseconds },
  };
}

export function makeRunState(run: WorkflowRun, host: WorkflowHost): RunState {
  const use = objectField(run.document, 'use') ?? {};
  const runs = new Map<string, number>();
  let context: Json = {};
  let stepsWithoutWaiting = 0;
  return {
    run,
    host,
    meter: makeMeter(host),
    components: {
      errors: objectField(use, 'errors') ?? {},
      retries: objectField(use, 'retries') ?? {},
      timeouts: objectField(use, 'timeouts') ?? {},
    },
    workflow: { id: run.execution.id, definition: run.document, input: run.input, startedAt: dateTimeOf(host.now()) },
    context: () => context,
    replaceContext: (next) => {
      context = next;
    },
    nextRun: (reference) => {
      const next = (runs.get(reference) ?? 0) + 1;
      runs.set(reference, next);
      return next;
    },
    step: (reference) => {
      stepsWithoutWaiting += 1;
      if (stepsWithoutWaiting > mostStepsWithoutWaiting) {
        throw raised(
          'runtime',
          500,
          `The workflow ran ${mostStepsWithoutWaiting} tasks without waiting for anything; it would never end`,
          reference,
        );
      }
    },
    checkHistory: (reference) => {
      requireRoomInHistory(host, reference);
    },
    beforeWaiting: (reference) => {
      requireRoomInHistory(host, reference);
      stepsWithoutWaiting = 0;
    },
    ...makeInbox(),
  };
}

export function admitted(value: Json, reference: string): Json {
  const measure = measureOf(value);
  if (measure === undefined) {
    throw raised('runtime', 500, `A value nests more than ${mostValueDepth} levels deep`, reference);
  }
  if (measure.work > mostValueWork) {
    throw raised(
      'runtime',
      500,
      `A value takes ${measure.work} units of work to visit, more than the ${mostValueWork} a workflow may hold`,
      reference,
    );
  }
  return value;
}

function makeMeter(host: WorkflowHost): Meter {
  let activation = -1;
  let work = 0;
  let tasks = 0;
  const current = (): void => {
    const { events } = host.historySize();
    if (events !== activation) {
      activation = events;
      work = 0;
      tasks = 0;
    }
  };
  return {
    allowance: () => {
      current();
      return Math.min(mostExpressionWork, mostActivationWork - work);
    },
    record: (done) => {
      current();
      work += done;
    },
    shouldYield: () => {
      current();
      return work >= mostExpressionWork || tasks >= mostTasksPerActivation;
    },
    countTask: () => {
      current();
      tasks += 1;
    },
  };
}

function makeInbox(): Pick<RunState, 'deliver' | 'eventsDelivered' | 'takeEvent'> {
  const inbox: JsonObject[] = [];
  const delivered = new Set<string>();
  return {
    deliver: (event) => {
      if (isEvent(event) && !delivered.has(event['id'])) {
        delivered.add(event['id']);
        inbox.push(event);
      }
    },
    eventsDelivered: () => delivered.size,
    takeEvent: (accepts) => {
      const position = inbox.findIndex((event) => accepts(event));
      return position === -1 ? undefined : inbox.splice(position, 1)[0];
    },
  };
}

function requireRoomInHistory(host: WorkflowHost, reference: string): void {
  const { bytes, events } = host.historySize();
  if (bytes > mostHistoryBytes || events > mostHistoryEvents) {
    throw raised(
      'runtime',
      500,
      `The workflow's history holds ${events} events in ${bytes} bytes, near the most Temporal keeps; it cannot do more`,
      reference,
    );
  }
}

function isEvent(value: unknown): value is JsonObject & { readonly id: string; readonly type: string } {
  return isJson(value) && isObject(value) && typeof value['id'] === 'string' && typeof value['type'] === 'string';
}
