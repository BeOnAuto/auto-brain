export type StreamAppended = (stream: string) => void;

export interface AppendSignal {
  readonly raise: (stream: string) => void;
  readonly listen: (listener: StreamAppended) => () => void;
}

const segmentsOfABrainKey = 3;

export function brainKeyOfStream(stream: string): string | undefined {
  const segments = stream.split('/');
  return segments[0] === 'brain' && segments.length > segmentsOfABrainKey
    ? `${segments.slice(0, segmentsOfABrainKey).join('/')}/`
    : undefined;
}

export function appendSignalOf(): AppendSignal {
  const listeners = new Set<StreamAppended>();
  return {
    raise: (stream) => {
      for (const listener of listeners) {
        listener(stream);
      }
    },
    listen: (listener) => {
      const own = (stream: string): void => {
        listener(stream);
      };
      listeners.add(own);
      return () => {
        listeners.delete(own);
      };
    },
  };
}

export const streamAppends: AppendSignal = appendSignalOf();
