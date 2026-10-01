import type { RegisterRoutes } from './routes.ts';

export type ReportIncident = (incident: string, error: Readonly<Error>) => void;

export interface ApiOptions {
  readonly allowedOrigins: readonly string[];
  readonly localMode: boolean;
  readonly routes: readonly RegisterRoutes[];
  readonly reportIncident: ReportIncident;
}
