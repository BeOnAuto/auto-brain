import { connectionsFold, connectionsStreamOfOrg } from '@on.auto/connections/testing';
import { ledgerLayer } from '@on.auto/ledger/sqlite3';
import { Ledger } from '@on.auto/operations';
import { serveFakeMcp } from '@on.auto/tool-servers/testing';
import { Effect, ManagedRuntime } from 'effect';
import { afterEach, describe, expect, it, onTestFinished } from 'vitest';

import { secretsKey } from '../testing/records/kept-credentials.ts';
import { temporaryLedger, type TemporaryLedger } from '../testing/records/temporary-ledger.ts';
import { aSecretHeader, connectedWith } from '../testing/servers/connected-servers.ts';
import { alpha, servingReasoning, type ReasoningServer } from '../testing/servers/reasoning-server.ts';

const crmKey = 'crm-api-key-6e2b9d41';

const anotherKey = Buffer.alloc(32, 9).toString('base64');

const unreadable: unknown = expect.stringContaining(
  'The credential of the connection crm cannot be read, so the person who added it removes it and adds it again: The secret is sealed under the key',
);

const brokenAsSaid: unknown = expect.stringContaining('cannot be read');

let ledger: TemporaryLedger | undefined;

afterEach(() => {
  ledger?.remove();
});

async function servedOn(
  fileName: string,
  environment: Readonly<Record<string, string>> = {},
): Promise<ReasoningServer> {
  const server = await servingReasoning([], {
    LEDGER_FILE: fileName,
    SECRETS_KEY: secretsKey.toString('base64'),
    ...environment,
  });
  const stopping: { done?: Promise<void> } = {};
  const stop = (): Promise<void> => {
    stopping.done ??= server.stop();
    return stopping.done;
  };
  onTestFinished(stop);
  return { ...server, stop };
}

async function connectedBeforeARestart(): Promise<{ readonly fileName: string; readonly id: string }> {
  const crm = await serveFakeMcp({ bearer: crmKey });
  onTestFinished(crm.close);
  ledger = temporaryLedger();
  const first = await servedOn(ledger.fileName);
  await first.call('POST', '/v1/orgs/acme/playbooks', { body: { playbook: 'alpha', name: 'Alpha' } });
  const id = await connectedWith(first, aSecretHeader('crm', crm.url), `Bearer ${crmKey}`);
  await first.stop();
  return { fileName: ledger.fileName, id };
}

async function connectionFactsIn(fileName: string): Promise<readonly string[]> {
  const runtime = ManagedRuntime.make(ledgerLayer({ fileName }));
  onTestFinished(() => runtime.dispose());
  const collecting = {
    ...connectionsFold,
    initialState: [],
    evolve: (types: readonly string[], { type }: { readonly type: string }) => [...types, type],
  };
  const { state } = await runtime.runPromise(
    Effect.flatMap(Ledger, (read) => read.load(connectionsStreamOfOrg('acme'), collecting)),
  );
  return state;
}

function executed(server: ReasoningServer) {
  return server.call('POST', `${alpha}/tool-servers/crm/tools/echo/execute`, { body: { arguments: {} } });
}

describe('a connection whose credential the secret store of a restarted runtime cannot read', () => {
  it('is broken once it is next used, the fact recorded, and listed broken in the sentence of why', async () => {
    const { fileName, id } = await connectedBeforeARestart();
    const restarted = await servedOn(fileName, { SECRETS_KEY: anotherKey });

    const refused = await executed(restarted);
    const searched = await restarted.call('GET', `${alpha}/tool-servers/search`);
    const read = await restarted.call('GET', `/v1/orgs/acme/connections/${id}`);

    expect(refused).toMatchObject({ status: 503, body: { kind: 'tool_not_offered', because: 'connection_broken' } });
    expect(searched.body).toMatchObject({
      servers: [{ name: 'crm', connection: id, because: 'connection_broken', unavailable: unreadable }],
    });
    expect(read.body).toMatchObject({ status: 'broken', broken: brokenAsSaid });
    expect((await connectionFactsIn(fileName)).at(-1)).toBe('connection_broken');
  });
});

describe('a connection the rules of a restarted runtime no longer allow', () => {
  it('is refused in the sentence of the rule, as adding it would be, and listed unavailable in it', async () => {
    const { fileName } = await connectedBeforeARestart();
    const restarted = await servedOn(fileName, { CONNECTIONS: JSON.stringify({ credential_kinds: ['none'] }) });
    const rule = 'A connection may not take a secret credential on this runtime, which allows none';

    const refused = await executed(restarted);
    const searched = await restarted.call('GET', `${alpha}/tool-servers/search`);

    expect(refused).toMatchObject({
      status: 503,
      body: { kind: 'tool_not_offered', because: 'connection_not_allowed', detail: rule },
    });
    expect(searched.body).toMatchObject({
      servers: [{ name: 'crm', because: 'connection_not_allowed', unavailable: rule }],
    });
  });
});
