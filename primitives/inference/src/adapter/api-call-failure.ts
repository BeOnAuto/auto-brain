import { Predicate } from 'effect';

import { ContentRefused } from '../failure/content-refused.ts';
import { CredentialsRejected } from '../failure/credentials-rejected.ts';
import type { ModelFailure } from '../failure/model-failure.ts';
import { ProviderUnavailable } from '../failure/provider-unavailable.ts';
import { RateLimited } from '../failure/rate-limited.ts';
import { SpecInvalid } from '../failure/spec-invalid.ts';

export interface ApiCallDetails {
  readonly provider: string;
  readonly status: number | undefined;
  readonly message: string;
  readonly responseBody: string | undefined;
  readonly headers: Readonly<Record<string, string>> | undefined;
  readonly data: unknown;
  readonly now: number;
}

const mostProviderMessageCharacters = 1000;

const contentFilterCodes: ReadonlySet<unknown> = new Set(['content_filter', 'content_policy_violation']);

const unavailableStatuses: ReadonlySet<number> = new Set([408, 409]);

function errorCodeOf(data: unknown): unknown {
  return Predicate.hasProperty(data, 'error') && Predicate.hasProperty(data.error, 'code')
    ? data.error.code
    : undefined;
}

function retryAfterSeconds(value: string, now: number): number | null {
  const seconds = Number(value);
  if (value.trim() !== '' && Number.isFinite(seconds)) {
    return Math.max(0, Math.ceil(seconds * 1000));
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

function retryAfterMs(headers: Readonly<Record<string, string>> | undefined, now: number): number | null {
  const milliseconds = Number(headers?.['retry-after-ms']);
  if (Number.isFinite(milliseconds) && milliseconds >= 0) {
    return Math.ceil(milliseconds);
  }
  const after = headers?.['retry-after'];
  return after === undefined ? null : retryAfterSeconds(after, now);
}

function providerMessage(message: string, responseBody: string | undefined): string | null {
  const quotesBody = responseBody !== undefined && responseBody.trim() !== '' && message.includes(responseBody.trim());
  return quotesBody || message.trim() === '' ? null : message.slice(0, mostProviderMessageCharacters);
}

function rejectedRequest({ provider, message, responseBody, data }: ApiCallDetails, code: number): ModelFailure {
  if (contentFilterCodes.has(errorCodeOf(data))) {
    return new ContentRefused({
      detail: `${provider} refused the request under its content policy`,
      provider,
      status: code,
      raw_finish_reason: null,
      usage: null,
    });
  }
  return new SpecInvalid({
    detail: `${provider} rejected the request as invalid (HTTP ${code})`,
    provider,
    status: code,
    provider_message: providerMessage(message, responseBody),
    issues: [],
  });
}

export function apiCallFailure(details: ApiCallDetails): ModelFailure {
  const { provider, status } = details;
  if (status === undefined) {
    return new ProviderUnavailable({ detail: `${provider} could not be reached`, provider, status: null });
  }
  if (status === 401 || status === 403) {
    return new CredentialsRejected({
      detail: `${provider} rejected the credentials (HTTP ${status})`,
      provider,
      status,
    });
  }
  if (status === 429) {
    return new RateLimited({
      detail: `${provider} is limiting the rate of requests`,
      provider,
      retry_after_ms: retryAfterMs(details.headers, details.now),
    });
  }
  if (status >= 500 || unavailableStatuses.has(status)) {
    return new ProviderUnavailable({
      detail: `${provider} could not serve the request (HTTP ${status})`,
      provider,
      status,
    });
  }
  return status < 400
    ? new ProviderUnavailable({ detail: `The response of ${provider} could not be read`, provider, status })
    : rejectedRequest(details, status);
}
