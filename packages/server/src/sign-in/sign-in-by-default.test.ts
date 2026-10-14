import { once } from 'node:events';
import { createServer } from 'node:net';

import { signInScope } from '@on.auto/identity';
import { describe, expect, it, onTestFinished } from 'vitest';

import { tcpPort } from '../lifecycle/http-server.ts';
import { defaultServerOptions, startServer, type RunningServer } from '../lifecycle/lifecycle.ts';
import { workflowTestTimeoutMs } from '../testing/servers/workflow-server.ts';
import { issuerOverHttps } from './issuer-over-https.ts';

async function aPortNothingListensOn(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = tcpPort(probe.address());
  probe.close();
  await once(probe, 'close');
  return port;
}

async function startedOn(port: number, environment: Readonly<Record<string, string>>): Promise<RunningServer> {
  const server = await startServer({ HOST: '127.0.0.1', PORT: String(port), ...environment }, defaultServerOptions);
  onTestFinished(() => server.stop());
  return server;
}

describe('a server on its own loopback address without PUBLIC_URL', { timeout: workflowTestTimeoutMs }, () => {
  it('signs persons in, with http://localhost and its port as the URL it is reached at', async () => {
    const issuer = await issuerOverHttps();
    const port = await aPortNothingListensOn();
    const ownAddress = `http://localhost:${port}`;

    const server = await startedOn(port, { IDENTITY_ISSUER: issuer.issuer });
    const metadata = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource/mcp`);
    const refused = await fetch(`http://127.0.0.1:${port}/v1/orgs/acme/playbooks`);

    expect(server.signIn).toEqual({ issuer: issuer.issuer, publicUrl: ownAddress });
    expect(await metadata.json()).toMatchObject({
      resource: `${ownAddress}/mcp`,
      authorization_servers: [issuer.issuer],
    });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${ownAddress}/.well-known/oauth-protected-resource", scope="${signInScope}"`,
    );
  });

  it('signs no one in when LOCAL_MODE asks it to trust every request instead', async () => {
    const server = await startedOn(await aPortNothingListensOn(), { LOCAL_MODE: 'true' });
    const metadata = await fetch(`http://127.0.0.1:${server.port}/.well-known/oauth-protected-resource`);

    expect(server.signIn).toBeUndefined();
    expect(metadata.status).toBe(404);
  });
});
