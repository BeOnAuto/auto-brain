import type { ApiEnv } from '@on.auto/api';
import type { AppendObserver } from '@on.auto/ledger';
import { Layer } from 'effect';
import type { MiddlewareHandler } from 'hono';

export interface Telemetry {
  readonly layer: Layer.Layer<never>;
  readonly requests: MiddlewareHandler<ApiEnv> | undefined;
  readonly appended: AppendObserver | undefined;
  readonly shutdown: () => Promise<void>;
}

export const noTelemetry: Telemetry = {
  layer: Layer.empty,
  requests: undefined,
  appended: undefined,
  shutdown: () => Promise.resolve(),
};
