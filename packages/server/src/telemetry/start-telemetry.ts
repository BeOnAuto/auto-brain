import { setTimeout } from 'node:timers/promises';

import type { ApiEnv } from '@on.auto/api';
import { Layer } from 'effect';
import type { MiddlewareHandler } from 'hono';

import { release } from '../composition/release.ts';
import { startInstrumentations } from './instrumentations.ts';
import { requestTracing } from './request-tracing.ts';
import type { TelemetrySettings } from './telemetry-settings.ts';
import { signalsOf } from './telemetry-signals.ts';

export interface Telemetry {
  readonly layer: Layer.Layer<never>;
  readonly requests: MiddlewareHandler<ApiEnv> | undefined;
  readonly shutdown: () => Promise<void>;
}

export const noTelemetry: Telemetry = {
  layer: Layer.empty,
  requests: undefined,
  shutdown: () => Promise.resolve(),
};

const longestShutdownMs = 3000;

export function startTelemetry(settings: TelemetrySettings | undefined): Telemetry {
  if (settings === undefined) {
    return noTelemetry;
  }
  const signals = signalsOf(settings, release);
  const stopInstrumentations = startInstrumentations();
  return {
    layer: Layer.mergeAll(Layer.empty, ...signals.map(({ layer }) => layer)),
    requests: requestTracing(),
    shutdown: async () => {
      stopInstrumentations();
      await Promise.race([
        Promise.allSettled(signals.map(({ shutdown }) => shutdown())),
        setTimeout(longestShutdownMs, undefined, { ref: false }),
      ]);
    },
  };
}
