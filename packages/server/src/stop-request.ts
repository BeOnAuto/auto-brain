export type StopSignal = 'SIGINT' | 'SIGTERM';

export interface SignalSource {
  on(signal: StopSignal, listener: () => void): unknown;
}

export function stopRequestedBy(signals: SignalSource): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const requestStop = (): void => {
    resolve();
  };
  signals.on('SIGTERM', requestStop);
  signals.on('SIGINT', requestStop);
  return promise;
}
