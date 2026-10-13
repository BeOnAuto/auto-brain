import { resolve } from 'node:path';

import type { AccessMode, SignInSettings } from '@on.auto/identity';
import type { Incident } from '@on.auto/operations';
import type { OperatorHintReport, ProviderMessageReport, ProviderStatus } from '@on.auto/reasoning';
import { Cause, Effect, Layer } from 'effect';

import type { ContentSettings } from '../settings/content-settings.ts';
import type { LedgerSettings, PostgreSQLLedgerSettings } from '../settings/ledger-settings.ts';
import { logsFrom, logsToStderr, type LogFormat, type LogLevelSetting } from './log-formats.ts';

export interface LogSettings {
  readonly logFormat: LogFormat;
  readonly logLevel: LogLevelSetting;
}

export function serverLogs({ logFormat, logLevel }: LogSettings): Layer.Layer<never> {
  return Layer.mergeAll(logsToStderr(logFormat), logsFrom(logLevel));
}

export interface AccessReport {
  readonly mode: AccessMode;
  readonly localMode: boolean;
  readonly apiKeys: readonly unknown[] | undefined;
  readonly signIn: SignInSettings | undefined;
}

const localModeOn = Effect.logWarning(
  'Local mode is on: every request is trusted as the local developer, with every permission in every org. Never enable LOCAL_MODE on a machine reachable through a proxy',
);

function closedNotice(localMode: boolean): Effect.Effect<void> {
  const why = localMode ? ', and LOCAL_MODE is ignored because API_KEYS is set' : ' and local mode is off';
  return Effect.logWarning(
    `No request can authenticate: API_KEYS lists no keys${why}, so every path except /health answers 401`,
  );
}

function configuredCredentials({ apiKeys = [], signIn }: AccessReport): string {
  return [...(apiKeys.length > 0 ? ['API keys'] : []), ...(signIn === undefined ? [] : ['identity providers'])].join(
    ' and ',
  );
}

function signInNotice(signIn: SignInSettings | undefined): readonly Effect.Effect<void>[] {
  return signIn === undefined
    ? []
    : [
        Effect.logInfo(
          `Signed-in persons are admitted through the identity providers ${[...new Set(signIn.providers.map(({ name }) => name))].join(', ')}, by tokens whose audience is ${signIn.publicUrl}`,
        ).pipe(
          Effect.annotateLogs({
            public_url: signIn.publicUrl,
            identity_providers: signIn.providers.map(({ name, issuer, org }) => ({ name, issuer, org })),
          }),
        ),
      ];
}

function credentialNotices(report: AccessReport): readonly Effect.Effect<void>[] {
  const ignored = report.localMode
    ? [Effect.logWarning(`LOCAL_MODE is ignored because ${configuredCredentials(report)} are configured`)]
    : [];
  return [...ignored, ...signInNotice(report.signIn)];
}

export function logAccessMode(report: AccessReport): Effect.Effect<void> {
  if (report.mode === 'local') {
    return localModeOn;
  }
  return report.mode === 'closed'
    ? closedNotice(report.localMode)
    : Effect.all(credentialNotices(report), { discard: true });
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

const privateMemory = ':memory:';

function ledgerFileLine(file: string): Effect.Effect<void> {
  return Effect.logInfo(`The ledger is kept in the file ${file}`).pipe(Effect.annotateLogs({ ledger_file: file }));
}

function postgresqlLine({ database, host, credentials }: PostgreSQLLedgerSettings): Effect.Effect<void> {
  const kept = `The ledger is kept in PostgreSQL, in the database ${database} on ${host}`;
  const annotations = { database, database_host: host, database_credentials: credentials.kind };
  if (credentials.kind === 'url') {
    return Effect.logInfo(kept).pipe(Effect.annotateLogs(annotations));
  }
  const { username, region } = credentials.signedFor;
  return Effect.logInfo(
    `${kept}, signing in as ${username} with a token signed for each connection from the AWS credential chain, for the region ${region}`,
  ).pipe(Effect.annotateLogs({ ...annotations, database_user: username, database_region: region }));
}

export function logLedger(ledger: LedgerSettings): Effect.Effect<void> {
  return ledger.store === 'postgresql'
    ? postgresqlLine(ledger)
    : ledgerFileLine(ledger.file === privateMemory ? ledger.file : resolve(ledger.file));
}

function objectStorageLine(bucket: string, prefix: string, endpoint: string | undefined): Effect.Effect<void> {
  const under = prefix === '' ? '' : ` under ${prefix}/`;
  const host = endpoint === undefined ? undefined : new URL(endpoint).host;
  return Effect.logInfo(
    `Content is kept on object storage, in the bucket ${bucket}${under}, on ${host ?? 'the S3 endpoint of its region'}`,
  ).pipe(
    Effect.annotateLogs({
      content_store: 'object-storage',
      content_bucket: bucket,
      content_prefix: prefix,
      ...(host === undefined ? {} : { content_endpoint: host }),
    }),
  );
}

export function logContentStore(content: ContentSettings): Effect.Effect<void> {
  return content.store === 'ledger'
    ? Effect.logInfo("Content is kept in the ledger's database").pipe(Effect.annotateLogs({ content_store: 'ledger' }))
    : objectStorageLine(content.location.bucket, content.location.prefix, content.endpoint);
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
    ? Effect.logWarning(`No model provider is configured, so reasoning functions cannot run; ${howToConfigureAModel}`)
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

export interface UnsettledReport {
  readonly org: string;
  readonly playbook: string;
  readonly runId: string;
  readonly reason: string;
}

export interface WorkflowsReport {
  readonly mostDurationMs: number;
  readonly mostCallsAtOnce: number;
  readonly sweepEveryMs: number;
}

const mostReportedCharacters = 2000;

const hour = 3_600_000;

const day = 24 * hour;

function spanOf(milliseconds: number): string {
  const [amount, unit] = milliseconds >= day ? [milliseconds / day, 'day'] : [milliseconds / hour, 'hour'];
  const rounded = Math.round(amount * 100) / 100;
  return `${rounded} ${unit}${rounded === 1 ? '' : 's'}`;
}

export function logWorkflows({ mostDurationMs, mostCallsAtOnce, sweepEveryMs }: WorkflowsReport): Effect.Effect<void> {
  return Effect.logInfo(
    `Workflows run in this server: a run lasts at most ${spanOf(mostDurationMs)}, at most ${mostCallsAtOnce} of their calls run at once, and the runs are swept every ${sweepEveryMs} ms`,
  ).pipe(
    Effect.annotateLogs({
      most_duration_ms: mostDurationMs,
      most_calls_at_once: mostCallsAtOnce,
      sweep_every_ms: sweepEveryMs,
    }),
  );
}

const counted = new Intl.NumberFormat('en');

export function logReasoning(mostInputTokens: number): Effect.Effect<void> {
  return Effect.logInfo(
    `Reasoning functions run in this server: the model calls of a run add up to at most ${counted.format(mostInputTokens)} input tokens, and each answer of a tool is read whole where it fits the model's context window`,
  ).pipe(Effect.annotateLogs({ most_input_tokens: mostInputTokens }));
}

export function logUnsettled({ org, playbook, runId, reason }: UnsettledReport): Effect.Effect<void> {
  return Effect.logError('A run stays started because settling it failed').pipe(
    Effect.annotateLogs({ org, playbook, run_id: runId, reason }),
  );
}

export function logWorkflowTrouble(what: string, cause: Cause.Cause<unknown>): Effect.Effect<void> {
  return Effect.logWarning(what).pipe(
    Effect.annotateLogs({ error: Cause.pretty(cause).slice(0, mostReportedCharacters) }),
  );
}

export function logLostWorkflowConnection(error: Readonly<Error>): Effect.Effect<void> {
  return Effect.logWarning(
    'A connection of the workflows to their PostgreSQL database was lost; they open another when they need one',
  ).pipe(Effect.annotateLogs({ error: error.message }));
}

export function logProviderMessage({
  provider,
  model,
  status,
  message,
  run_id,
}: ProviderMessageReport): Effect.Effect<void> {
  return Effect.logWarning(`Model provider ${provider} answered with an error`).pipe(
    Effect.annotateLogs({ provider, model, status, run_id, provider_message: message }),
  );
}

export function logOperatorHint({ provider, model, hint, run_id }: OperatorHintReport): Effect.Effect<void> {
  return Effect.logWarning(`Model provider ${provider} could not be called: ${hint}`).pipe(
    Effect.annotateLogs({ provider, model, run_id }),
  );
}
