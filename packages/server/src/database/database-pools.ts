import { plainPoolsOn, type PostgreSQLPools } from '@on.auto/ledger/postgresql';
import type { ProxySettings } from '@on.auto/outbound';
import { awsDatabaseTokenSigner, type DatabaseTokenRequest, type DatabaseTokenSigner } from '@on.auto/outbound/aws';
import { Redacted } from 'effect';
import { Pool } from 'pg';

import type { PostgreSQLLedgerSettings } from '../settings/ledger-settings.ts';

export type DatabaseTokenSignerOf = (proxy: ProxySettings, request: DatabaseTokenRequest) => DatabaseTokenSigner;

export function databasePoolsOf(
  ledger: PostgreSQLLedgerSettings,
  proxy: ProxySettings,
  signerOf: DatabaseTokenSignerOf = awsDatabaseTokenSigner,
): PostgreSQLPools {
  const { credentials, database } = ledger;
  if (credentials.kind === 'url') {
    return plainPoolsOn(Redacted.value(ledger.url));
  }
  const { hostname, port, username } = credentials.signedFor;
  const signedToken = signerOf(proxy, credentials.signedFor);
  return ({ max }) =>
    new Pool({ host: hostname, port, user: username, database, ssl: true, password: signedToken, max });
}
