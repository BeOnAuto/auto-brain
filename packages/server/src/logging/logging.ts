import type { AccessMode } from '@beonauto/identity';
import type { OperatorHintReport, ProviderMessageReport, ProviderStatus } from '@beonauto/inference';
import type { Incident } from '@beonauto/operations';
import { Cause, Effect, Logger, type Layer } from 'effect';

import type { LedgerSettings } from '../settings/ledger-settings.ts';

export type LogFormat = 'json' | 'pretty';

interface LogEntry {
  readonly message: unknown;
  readonly level: string;
  readonly timestamp: string;
  readonly cause: string | undefined;
  readonly annotations: Readonly<Record<string, unknown>>;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

function clockOf(timestamp: string): string {
  const date = new Date(timestamp);
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map((part) => twoDigits(part)).join(':');
  return `${time}.${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function valueText(value: unknown): string {
  return typeof value === 'string' && /^\S+$/u.test(value) ? value : JSON.stringify(value);
}

function prettyLine({ message, level, timestamp, cause, annotations }: LogEntry): string {
  const { source, ...details } = annotations;
  const line = [
    clockOf(timestamp),
    level.padEnd(5),
    ...(source === undefined ? [] : [`[${valueText(source)}]`]),
    typeof message === 'string' ? message : JSON.stringify(message),
    ...Object.entries(details).map(([name, value]: readonly [string, unknown]) => `${name}=${valueText(value)}`),
  ].join(' ');
  return cause === undefined ? line : `${line}\n${cause.replaceAll(/^/gmu, '    ')}`;
}

export const formatPretty = Logger.map(Logger.formatStructured, prettyLine);

export function logsToStderr(format: LogFormat): Layer.Layer<never> {
  return Logger.layer([Logger.withConsoleError(format === 'json' ? Logger.formatJson : formatPretty)]);
}

const accessNotices: Readonly<Record<AccessMode, Effect.Effect<void>>> = {
  local: Effect.logWarning(
    'Local mode is on: every request is trusted as the local developer, with every permission in every org. Never enable LOCAL_MODE on a machine reachable through a proxy',
  ),
  closed: Effect.logWarning(
    'No request can authenticate: API_KEYS lists no keys and local mode is off, so every path except /health answers 401',
  ),
  keys: Effect.void,
};

const localModeIgnored = Effect.logWarning('LOCAL_MODE is ignored because API keys are configured');

export function logAccessMode(mode: AccessMode, localModeRequested: boolean): Effect.Effect<void> {
  return localModeRequested && mode !== 'local'
    ? Effect.andThen(accessNotices[mode], localModeIgnored)
    : accessNotices[mode];
}

export interface ConfigFileReport {
  readonly path: string;
  readonly fromFile: readonly string[];
  readonly overridden: readonly string[];
}

function overriddenNotice(path: string, overridden: readonly string[]): readonly Effect.Effect<void>[] {
  return overridden.length === 0
    ? []
    : [
        Effect.logInfo(
          `Set both in the environment and in the configuration file, so the environment's value is used: ${overridden.join(', ')}`,
        ).pipe(Effect.annotateLogs({ config_file: path, settings: overridden })),
      ];
}

export function logConfigFile(report?: ConfigFileReport): Effect.Effect<void> {
  if (report === undefined) {
    return Effect.void;
  }
  const { path, fromFile, overridden } = report;
  const read = fromFile.length === 0 ? 'none' : fromFile.join(', ');
  return Effect.all(
    [
      Effect.logInfo(`Settings read from the configuration file ${path}: ${read}`).pipe(
        Effect.annotateLogs({ config_file: path, settings: fromFile }),
      ),
      ...overriddenNotice(path, overridden),
    ],
    { discard: true },
  );
}

export function logLedger(ledger: LedgerSettings): Effect.Effect<void> {
  return ledger.store === 'postgresql'
    ? Effect.logInfo(`The ledger is kept in PostgreSQL, in the database ${ledger.database} on ${ledger.host}`).pipe(
        Effect.annotateLogs({ database: ledger.database, database_host: ledger.host }),
      )
    : Effect.void;
}

const causeNotFormattable = Effect.logError('Unexpected error whose cause could not be formatted');

function withoutRequestContent(error: Readonly<Error>): string {
  return error instanceof SyntaxError ? 'The request body is not valid JSON' : error.message;
}

export function logMcpError(error: Readonly<Error>): Effect.Effect<void> {
  return Effect.logWarning('The MCP layer reported an error').pipe(
    Effect.annotateLogs({ error: withoutRequestContent(error) }),
  );
}

export function logIncident({ id, original, call }: Incident): Effect.Effect<void> {
  return Effect.logError('Unexpected error', Cause.die(original)).pipe(
    Effect.catchCause(() => causeNotFormattable),
    Effect.ignoreCause,
    Effect.annotateLogs({ incident: id, ...call }),
  );
}

const howToConfigureAModel = 'set ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY or MODEL_GATEWAYS';

interface ProviderAnnotation {
  readonly provider: string;
  readonly configured: boolean;
  readonly missing?: readonly string[];
}

function providerAnnotations({ configured, unconfigured }: ProviderStatus): readonly ProviderAnnotation[] {
  return [
    ...configured.map((provider) => ({ provider, configured: true })),
    ...unconfigured.map(({ provider, missing }) => ({ provider, configured: false, missing })),
  ];
}

function providersSummary({ configured }: ProviderStatus): Effect.Effect<void> {
  return configured.length === 0
    ? Effect.logWarning(`No model provider is configured, so inference specs cannot run; ${howToConfigureAModel}`)
    : Effect.logInfo(`Model providers configured: ${configured.join(', ')}`);
}

export function logModelProviders(status: ProviderStatus): Effect.Effect<void> {
  const partlyConfigured = status.unconfigured.filter(({ partial }) => partial === true);
  return Effect.all(
    [
      providersSummary(status).pipe(Effect.annotateLogs({ providers: providerAnnotations(status) })),
      ...partlyConfigured.map(({ provider, missing }) =>
        Effect.logWarning(`Model provider ${provider} is not configured; it needs ${missing.join(' and ')}`).pipe(
          Effect.annotateLogs({ provider, configured: false, missing }),
        ),
      ),
    ],
    { discard: true },
  );
}

export interface WorkflowsAddress {
  readonly address: string;
  readonly namespace: string;
  readonly taskQueue: string;
}

export interface UnsettledReport {
  readonly org: string;
  readonly brain: string;
  readonly executionId: string;
  readonly reason: string;
}

export const logWorkflowsNotOffered = Effect.logInfo('Workflows are not offered because TEMPORAL_ADDRESS is unset');

export function logWorkflowsOffered({ address, namespace, taskQueue }: WorkflowsAddress): Effect.Effect<void> {
  return Effect.logInfo(
    `Workflows are offered with Temporal at ${address}, namespace ${namespace}, task queue ${taskQueue}`,
  ).pipe(Effect.annotateLogs({ temporal_address: address, namespace, task_queue: taskQueue }));
}

export const logWorkerStarted = Effect.logInfo('The workflow worker started');

function inSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function logWorkerNotStarted(detail: string, retryMs: number): Effect.Effect<void> {
  return Effect.logWarning(`The workflow worker could not start; it tries again in ${inSeconds(retryMs)}`).pipe(
    Effect.annotateLogs({ error: detail, retry_ms: retryMs }),
  );
}

export function logWorkerStopped(detail: string, retryMs: number): Effect.Effect<void> {
  return Effect.logError(`The workflow worker stopped on its own; it starts again in ${inSeconds(retryMs)}`).pipe(
    Effect.annotateLogs({ error: detail, retry_ms: retryMs }),
  );
}

export function logUnsettled({ org, brain, executionId, reason }: UnsettledReport): Effect.Effect<void> {
  return Effect.logError('An execution stays started because settling it failed').pipe(
    Effect.annotateLogs({ org, brain, execution_id: executionId, reason }),
  );
}

export interface TemporalReport {
  readonly level: string;
  readonly message: string;
  readonly context: Readonly<Record<string, string | number | boolean>>;
}

const temporalLevels: Readonly<Record<string, (message: string) => Effect.Effect<void>>> = {
  ERROR: Effect.logError,
  INFO: Effect.logInfo,
};

export function logTemporal({ level, message, context }: TemporalReport): Effect.Effect<void> {
  return (temporalLevels[level] ?? Effect.logWarning)(message).pipe(Effect.annotateLogs(context));
}

export function logProviderMessage({
  provider,
  model,
  status,
  message,
  execution_id,
}: ProviderMessageReport): Effect.Effect<void> {
  return Effect.logWarning(`Model provider ${provider} answered with an error`).pipe(
    Effect.annotateLogs({ provider, model, status, execution_id, provider_message: message }),
  );
}

export function logOperatorHint({ provider, model, hint, execution_id }: OperatorHintReport): Effect.Effect<void> {
  return Effect.logWarning(`Model provider ${provider} could not be called: ${hint}`).pipe(
    Effect.annotateLogs({ provider, model, execution_id }),
  );
}
