import { measureOf, mostValueDepth, objectField, type Json, type JsonObject } from '@beonauto/workflow-engine/dsl/json';
import type { Components } from '@beonauto/workflow-engine/dsl/policy-checks';
import {
  mostExpressionWork,
  mostStepsWithoutWaiting,
  mostTasksPerInput,
  mostWorkPerInput,
} from '@beonauto/workflow-engine/limits';

import { makeHolding, type Hold } from './holding.ts';
import type { WorkflowHost } from './host.ts';
import { makeInbox, type Inbox } from './inbox.ts';
import { raised } from './raised-error.ts';
import type { WorkflowRun } from './workflow-run.ts';

export interface Meter {
  readonly allowance: () => number;
  readonly record: (work: number) => void;
  readonly shouldYield: () => boolean;
  readonly countTask: () => void;
}

export interface RunState extends Inbox {
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
  readonly hold: Hold;
}

export const runtimeDescriptor: JsonObject = {
  name: 'auto-brain',
  version: '1',
  metadata: { primitive: 'orchestration' },
};

export const mostHistoryBytes = 8_388_608;

export const mostHistoryEvents = 40_000;

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
  const hold = makeHolding();
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
    ...contextHeldBy(hold),
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
    hold,
    ...makeInbox(),
  };
}

function contextHeldBy(hold: Hold): Pick<RunState, 'context' | 'replaceContext'> {
  let context: Json = {};
  let releaseContext = hold([context], '/');
  return {
    context: () => context,
    replaceContext: (next) => {
      const releaseNext = hold([next], '/');
      releaseContext();
      context = next;
      releaseContext = releaseNext;
    },
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
      return Math.min(mostExpressionWork, mostWorkPerInput - work);
    },
    record: (done) => {
      current();
      work += done;
    },
    shouldYield: () => {
      current();
      return work >= mostExpressionWork || tasks >= mostTasksPerInput;
    },
    countTask: () => {
      current();
      tasks += 1;
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
