import type { RunnableWorker, TemporalWorkers, WorkerDefinition } from '../worker/orchestration-worker.ts';

export interface FakeTemporalWorkers {
  readonly temporal: TemporalWorkers;
  readonly events: () => readonly string[];
  readonly definitions: () => readonly WorkerDefinition[];
  readonly end: (failure?: string) => void;
}

export interface FakeTemporalOptions {
  readonly signals?: readonly string[];
  readonly creation?: string;
}

interface Run {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function fakeWorker(record: (event: string) => void, run: Run): RunnableWorker {
  let running = true;
  const stopped = (): boolean => {
    running = false;
    return running;
  };
  void run.promise.then(stopped, stopped);
  return {
    run: () => run.promise,
    shutdown: () => {
      record('shutdown');
      run.resolve();
    },
    isRunning: () => running,
  };
}

export function fakeTemporalWorkers({ signals = [], creation }: FakeTemporalOptions = {}): FakeTemporalWorkers {
  const events: string[] = [];
  const definitions: WorkerDefinition[] = [];
  const run = Promise.withResolvers<void>();
  const record = (event: string): void => {
    events.push(event);
  };
  const connection = {
    create: (definition: WorkerDefinition) => {
      definitions.push(definition);
      return creation === undefined ? Promise.resolve(fakeWorker(record, run)) : Promise.reject(new Error(creation));
    },
    close: () => {
      record('close');
      return Promise.resolve();
    },
  };
  return {
    temporal: { shutdownSignals: () => signals, connect: () => Promise.resolve(connection) },
    events: () => events,
    definitions: () => definitions,
    end: (failure) => {
      if (failure === undefined) {
        run.resolve();
      } else {
        run.reject(new Error(failure));
      }
    },
  };
}
