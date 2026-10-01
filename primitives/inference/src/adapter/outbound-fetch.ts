import { Predicate } from 'effect';

import { OutboundFailure } from './outbound-failure.ts';

const untrustedCertificateCodes: ReadonlySet<unknown> = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'CERT_SIGNATURE_FAILURE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

const mostCauses = 8;

function causesOf(error: unknown): readonly unknown[] {
  const causes: unknown[] = [];
  let current: unknown = error;
  while (causes.length < mostCauses && Predicate.isObject(current)) {
    causes.push(current);
    current = current['cause'];
  }
  return causes;
}

function isUntrustedCertificate(error: unknown): boolean {
  return causesOf(error).some(
    (cause) => Predicate.hasProperty(cause, 'code') && untrustedCertificateCodes.has(cause.code),
  );
}

export function withCertificateFailures<Args extends readonly unknown[], Answer>(
  send: (...args: Args) => Promise<Answer>,
): (...args: Args) => Promise<Answer> {
  return async (...args) => {
    try {
      return await send(...args);
    } catch (error) {
      if (isUntrustedCertificate(error)) {
        throw new OutboundFailure('untrusted_certificate');
      }
      throw error;
    }
  };
}
