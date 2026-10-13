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

const publicUrl = 'https://runtime.example';

function providersAt(issuer: string): string {
  return JSON.stringify([
    {
      name: 'corp',
      issuer,
      org: 'acme',
      grants: { claim: 'groups', by: { engineers: { permissions: allPermissions, playbooks: '*' } } },
    },
  ]);
}

describe('a signed-in person on the facts', { timeout: workflowTestTimeoutMs }, () => {
  it('is named person:<provider>/<subject> as who created the playbook and the definition, started the run and answered it', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn({ IDENTITY_PROVIDERS: providersAt(issuer.issuer), PUBLIC_URL: publicUrl });
    const seconds = Math.floor(Date.now() / 1000);
    const key = await issuer.sign({
      iss: issuer.issuer,
      sub: 'auth0|ada',
      aud: publicUrl,
      iat: seconds,
      exp: seconds + 300,
      groups: ['engineers'],
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
      { created_by: 'person:corp/auth0|ada' },
      { created_by: 'person:corp/auth0|ada' },
      { started_by: 'person:corp/auth0|ada' },
      { answered_by: 'person:corp/auth0|ada' },
    ]);
  });
});

describe('a server with an identity provider', { timeout: workflowTestTimeoutMs }, () => {
  it('serves the protected resource metadata without a key, naming the provider as its authorization server', async () => {
    const issuer = await issuerOverHttps();
    const server = await interactionServerOn({ IDENTITY_PROVIDERS: providersAt(issuer.issuer), PUBLIC_URL: publicUrl });

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

  it('does not start when the provider cannot be read, naming it', async () => {
    const ledger = temporaryLedger();

    const failure = await startServer(
      {
        HOST: '127.0.0.1',
        PORT: '0',
        LEDGER_FILE: ledger.fileName,
        PREDICTION_CACHE_DIR: ledger.cacheDirectory,
        IDENTITY_PROVIDERS: providersAt('https://127.0.0.1:9'),
        PUBLIC_URL: publicUrl,
      },
      compositionRoot,
    ).catch((error: unknown) => error);
    ledger.remove();

    expect(failure).toMatchObject({ name: 'UnusableProviderError' });
    expect(String(failure)).toMatch(
      /^UnusableProviderError: The identity provider corp cannot be used: no metadata of https:\/\/127\.0\.0\.1:9 could be used: /u,
    );
  });
});
