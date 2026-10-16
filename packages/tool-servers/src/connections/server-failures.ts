import { INVALID_PARAMS, ProtocolError, SdkError, SdkErrorCode, SdkHttpError } from '@modelcontextprotocol/client';
import { codesOf, isUntrustedCertificate } from '@on.auto/outbound';
import { Data, Option, Predicate } from 'effect';

import { AnsweredStatus } from '../openapi/answered-status.ts';
import { ArgumentsRefused } from '../openapi/arguments-refused.ts';

export type FailureKind =
  | 'unreachable'
  | 'failing'
  | 'rate_limited'
  | 'forgotten'
  | 'closed'
  | 'timed_out'
  | 'refused'
  | 'key_refused'
  | 'too_large'
  | 'not_allowed';

export interface ServerFailure {
  readonly kind: FailureKind;
  readonly message: string;
}

const unreachableCodes: ReadonlySet<unknown> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ENOENT',
  'EACCES',
]);

const closedCodes: ReadonlySet<unknown> = new Set([
  SdkErrorCode.ConnectionClosed,
  SdkErrorCode.NotConnected,
  SdkErrorCode.SendFailed,
]);

const httpKinds: ReadonlyMap<number, FailureKind> = new Map([
  [401, 'key_refused'],
  [404, 'forgotten'],
  [429, 'rate_limited'],
]);

export class HostRefused extends Data.TaggedError('host_refused')<{ readonly rule: string }> {}

const mostCausesFollowed = 8;

function refusedRuleIn(error: unknown, followed = 0): Option.Option<string> {
  if (error instanceof HostRefused) {
    return Option.some(error.rule);
  }
  return followed < mostCausesFollowed && Predicate.hasProperty(error, 'cause')
    ? refusedRuleIn(error.cause, followed + 1)
    : Option.none();
}

export const untrustedCertificate =
  'The TLS certificate of the tool server is not trusted by this server; its operator must add the certificate authority with NODE_EXTRA_CA_CERTS';

function httpFailure(status: number): ServerFailure {
  return { kind: httpKinds.get(status) ?? 'failing', message: `The tool server answered HTTP ${status}` };
}

function sdkFailure(code: SdkErrorCode, message: string): ServerFailure {
  if (code === SdkErrorCode.RequestTimeout) {
    return { kind: 'timed_out', message: 'The tool server did not answer in time' };
  }
  return closedCodes.has(code)
    ? { kind: 'closed', message: 'The connection to the tool server closed' }
    : { kind: 'failing', message };
}

function protocolFailure(code: number, message: string): ServerFailure {
  return code === INVALID_PARAMS
    ? { kind: 'refused', message }
    : { kind: 'failing', message: `The MCP server answered with an error: ${message}` };
}

function networkFailure(error: unknown): ServerFailure {
  const codes = codesOf(error);
  if (isUntrustedCertificate(error)) {
    return { kind: 'failing', message: untrustedCertificate };
  }
  return codes.some((code) => unreachableCodes.has(code))
    ? { kind: 'unreachable', message: 'The tool server could not be reached' }
    : { kind: 'failing', message: error instanceof Error ? error.message : String(error) };
}

function knownFailureOf(error: unknown): ServerFailure {
  if (error instanceof SdkHttpError || error instanceof AnsweredStatus) {
    return httpFailure(error.status);
  }
  if (error instanceof ArgumentsRefused) {
    return { kind: 'refused', message: error.message };
  }
  if (error instanceof SdkError) {
    return sdkFailure(error.code, error.message);
  }
  return error instanceof ProtocolError ? protocolFailure(error.code, error.message) : networkFailure(error);
}

export function failureOf(error: unknown): ServerFailure {
  return Option.match(refusedRuleIn(error), {
    onSome: (rule): ServerFailure => ({ kind: 'not_allowed', message: rule }),
    onNone: () => knownFailureOf(error),
  });
}
