export type BrainAppended = (brainKey: string) => void;

export interface AppendSignal {
  readonly raise: (stream: string) => void;
  readonly listen: (listener: BrainAppended) => () => void;
}

const segmentsOfABrainKey = 3;

export function brainKeyOfStream(stream: string): string | undefined {
  const segments = stream.split('/');
  return segments[0] === 'brain' && segments.length > segmentsOfABrainKey
    ? `${segments.slice(0, segmentsOfABrainKey).join('/')}/`
    : undefined;
}

export function appendSignalOf(): AppendSignal {
  const listeners = new Set<BrainAppended>();
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
      const own = (brainKey: string): void => {
        listener(brainKey);
      };
      listeners.add(own);
      return () => {
        listeners.delete(own);
      };
    },
  };
}

export const brainAppends: AppendSignal = appendSignalOf();
