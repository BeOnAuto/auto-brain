import { Context, type Effect } from 'effect';

export class IncidentReporter extends Context.Service<
  IncidentReporter,
  {
    readonly report: (incident: string, original: unknown) => Effect.Effect<void>;
  }
>()('@beonauto/operations/IncidentReporter') {}
