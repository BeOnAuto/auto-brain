import { Predicate } from 'effect';

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

export function codesOf(error: unknown): readonly unknown[] {
  const codes: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < mostCauses && Predicate.isObject(current); depth += 1) {
    codes.push(Predicate.hasProperty(current, 'code') ? current.code : undefined);
    current = current['cause'];
  }
  return codes;
}

export function isUntrustedCertificate(error: unknown): boolean {
  return codesOf(error).some((code) => untrustedCertificateCodes.has(code));
}
