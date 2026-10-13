import { approvalDocument } from '@on.auto/interaction/testing';
import { allPermissions } from '@on.auto/operations';
import { describe, expect, it } from 'vitest';

import { compositionRoot } from '../composition/composition-root.ts';
import { startServer } from '../lifecycle/lifecycle.ts';
import { temporaryLedger } from '../testing/records/temporary-ledger.ts';
import { brief, interactionServerOn } from '../testing/servers/interaction-server.ts';
import { alpha } from '../testing/servers/reasoning-server.ts';
import { runIdIn, workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';
import { issuerOverHttps } from './issuer-over-https.ts';

const publicUrl = 'http://localhost:5555';

function signingIn(issuer: string): Readonly<Record<string, string>> {
  return { IDENTITY_ISSUER: issuer, PUBLIC_URL: publicUrl };
}

describe('a signed-in person on the facts', { timeout: workflowTestTimeoutMs }, () => {
  it('is named person:<subject> as who created the playbook and the definition, started the run and answered it', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn(signingIn(issuer.issuer));
    const seconds = Math.floor(Date.now() / 1000);
    const key = await issuer.sign({
      iss: issuer.issuer,
      sub: 'user|ada',
      aud: publicUrl,
      iat: seconds,
      exp: seconds + 300,
      org_id: 'acme',
    });

    const playbook = await server.call('POST', '/v1/orgs/acme/playbooks', {
      key,
      body: { playbook: 'alpha', name: 'Alpha' },
    });
    const definition = await server.call('POST', `${alpha}/definitions/interaction`, {
      key,
      body: { name: 'approve-brief', source: approvalDocument() },
    });
    const started = await server.call('POST', `${alpha}/definitions/interaction/approve-brief/run`, {
      key,
      body: { input: brief },
    });
    const runId = runIdIn(started.body);
    const answered = await server.call('POST', `${alpha}/runs/${runId}/answer`, {
      key,
      body: { answer: { choice: 'approve' } },
    });
    const run = await server.call('GET', `${alpha}/runs/${runId}`, { key });

    expect([playbook.body, definition.body, run.body, answered.body]).toMatchObject([
      { created_by: 'person:user|ada' },
      { created_by: 'person:user|ada' },
      { started_by: 'person:user|ada' },
      { answered_by: 'person:user|ada' },
    ]);
  });
});

describe('a server that signs persons in', { timeout: workflowTestTimeoutMs }, () => {
  it('serves the protected resource metadata without a key, naming the identity service as its authorization server', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn(signingIn(issuer.issuer));

    const metadata = await server.call('GET', '/.well-known/oauth-protected-resource/mcp');
    const unauthenticated = await server.call('GET', '/v1/orgs/acme/playbooks');

    expect(metadata).toMatchObject({
      status: 200,
      body: { resource: `${publicUrl}/mcp`, authorization_servers: [issuer.issuer] },
    });
    expect(unauthenticated.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource", scope="${allPermissions.join(' ')}"`,
    );
  });

  it('does not start when the identity service cannot be read, naming it', async () => {
    const ledger = temporaryLedger();

    const failure = await startServer(
      {
        HOST: '127.0.0.1',
        PORT: '0',
        LEDGER_FILE: ledger.fileName,
        PREDICTION_CACHE_DIR: ledger.cacheDirectory,
        ...signingIn('https://127.0.0.1:9'),
      },
      compositionRoot,
    ).catch((error: unknown) => error);
    ledger.remove();

    expect(failure).toMatchObject({ name: 'UnusableIdentityServiceError' });
    expect(String(failure)).toMatch(
      /^UnusableIdentityServiceError: The identity service at https:\/\/127\.0\.0\.1:9 cannot be used: no metadata of https:\/\/127\.0\.0\.1:9 could be used: /u,
    );
  });
});
