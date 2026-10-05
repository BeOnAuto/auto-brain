import { Effect } from 'effect';

import type { OperatorHintReport, ProviderMessageReport } from '../adapter/model-access-options.ts';
import type { ModelAccess } from '../adapter/model-access.ts';
import type { ListingCache } from '../catalog/listing-cache.ts';
import type { ModelList } from '../catalog/model-list.ts';
import type { Environment } from '../settings/setting-values.ts';
import { accessFor } from './adapter-harness.ts';
import { recordingHints, recordingReporter } from './provider-errors.ts';
import { recordingFetch, type RecordingFetch, type Responder } from './recording-fetch.ts';

export interface CatalogHarness {
  readonly access: ModelAccess;
  readonly list: (provider?: string) => Promise<ModelList>;
  readonly requests: RecordingFetch['requests'];
  readonly reports: () => readonly ProviderMessageReport[];
  readonly hints: () => readonly OperatorHintReport[];
}

export interface CatalogOptions {
  readonly listingCache?: ListingCache;
}

export async function catalogFor(
  environment: Environment,
  responder: Responder,
  options: CatalogOptions = {},
): Promise<CatalogHarness> {
  const recording = recordingFetch(responder);
  const reporter = recordingReporter();
  const hints = recordingHints();
  const access = await accessFor(environment, {
    ...options,
    fetch: recording.fetch,
    reportProviderMessage: reporter.report,
    reportOperatorHint: hints.report,
  });
  return {
    access,
    list: (provider) => Effect.runPromise(access.catalog.list(provider)),
    requests: recording.requests,
    reports: reporter.reports,
    hints: hints.hints,
  };
}

export function idsIn({ data }: ModelList): readonly string[] {
  return data.map(({ id }) => id);
}
