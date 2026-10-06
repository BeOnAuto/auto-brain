import type { StreamStore } from '../event-store.ts';

export type AppendListener = (brainKey: string) => void;

export interface AppendSignal {
  readonly raise: (stream: string) => void;
  readonly listen: (listener: AppendListener) => () => void;
}

const segmentsOfABrainKey = 3;

export function brainKeyOfStream(stream: string): string | undefined {
  const segments = stream.split('/');
  return segments.length > segmentsOfABrainKey ? `${segments.slice(0, segmentsOfABrainKey).join('/')}/` : undefined;
}

export function appendSignal(): AppendSignal {
  const listeners = new Set<AppendListener>();
  return {
    raise: (stream) => {
      const brainKey = brainKeyOfStream(stream);
      if (brainKey !== undefined) {
        for (const listener of listeners) {
          listener(brainKey);
        }
      }
    },
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function signalledOn<Store extends StreamStore>(store: Store, signal?: AppendSignal): Store {
  if (signal === undefined) {
    return store;
  }
  return {
    ...store,
    append: async (stream, events, expectedVersion, lineage) => {
      await store.append(stream, events, expectedVersion, lineage);
      signal.raise(stream);
    },
  };
}
