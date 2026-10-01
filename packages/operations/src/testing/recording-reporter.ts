import { Effect, Layer } from 'effect';

import { IncidentReporter } from '../index.ts';

export interface ReportedIncident {
  readonly incident: string;
  readonly original: unknown;
}

export interface RecordingReporter {
  readonly layer: Layer.Layer<IncidentReporter>;
  readonly reported: () => readonly ReportedIncident[];
}

export function recordingReporter(): RecordingReporter {
  const reported: ReportedIncident[] = [];
  return {
    layer: Layer.succeed(
      IncidentReporter,
      IncidentReporter.of({
        report: (incident, original) =>
          Effect.sync(() => {
            reported.push({ incident, original });
          }),
      }),
    ),
    reported: () => reported,
  };
}
