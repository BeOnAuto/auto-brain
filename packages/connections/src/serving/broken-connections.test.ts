import type { ConnectionSource, ConnectionUnready, OrgConnection } from '@on.auto/tool-servers';
import { Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { connectionPolicyOf, type ConnectionPolicyFields } from '../policy/connection-policy.ts';
import type { ConnectionAddition, ConnectionCommand } from '../registry/connection-commands.ts';
import { connectionsStreamOfOrg, registryDecider } from '../registry/registry-decider.ts';
import { added, crm, notes } from '../testing/additions.ts';
import { ada, harness, operationNamed, type Harness } from '../testing/harness.ts';
import { makeConnectionSource, type ServingServices } from './connection-source.ts';

const sealedElsewhere = 'The secret is sealed under the key k2, which is neither the current key nor the previous one';

function sourceOf(h: Harness, changes: Partial<Omit<ServingServices, 'registry'>> = {}): ConnectionSource {
  return makeConnectionSource({
    registry: h.ledger.service,
    secrets: h.secrets,
    policy: connectionPolicyOf({}),
    variables: new Map(),
    providers: ['openai'],
    ...changes,
  });
}

function policyOf(fields: ConnectionPolicyFields) {
  return { policy: connectionPolicyOf(fields) };
}

async function connectedCrm(h: Harness): Promise<string> {
  const { id, token } = await added(h, crm);
  await h.call(operationNamed(h.operations, 'give_credential'), ada, { id, token, value: 'Bearer crm-key-0f3c9a71' });
  return id;
}

async function connectionOf(source: ConnectionSource, id: string): Promise<OrgConnection> {
  return Option.getOrThrow(
    Option.fromNullishOr((await Effect.runPromise(source.connectionsOf('acme'))).find((each) => each.id === id)),
  );
}

async function refusalOf(source: ConnectionSource, id: string): Promise<ConnectionUnready> {
  const { state } = await connectionOf(source, id);
  return state.status === 'connected' ? Effect.runPromise(Effect.flip(state.server)) : state.unready;
}

function recordedDirectly(
  h: Harness,
  name: string,
  changes: Partial<Pick<ConnectionAddition, 'entry' | 'credential'>>,
) {
  const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };
  const adding: ConnectionCommand = {
    type: 'add',
    connection: name,
    name,
    kind: 'mcp',
    entry: { url: 'https://odd.example.com/mcp' },
    credential: { kind: 'none' },
    link: { token_sha256: 'link', expires_at: '2026-10-15T14:10:00.000Z' },
    ...changes,
    ...acted,
  };
  const approving: ConnectionCommand = {
    type: 'approve',
    connection: name,
    token_sha256: 'link',
    bindsPerson: false,
    ...acted,
  };
  const stream = connectionsStreamOfOrg('acme');
  return Effect.runPromise(
    Effect.andThen(
      h.ledger.service.execute(stream, registryDecider, adding),
      h.ledger.service.execute(stream, registryDecider, approving),
    ),
  );
}

describe('a connection whose credential the secret store cannot read', () => {
  it('is broken by the runtime with the sentence of why, and answered broken from then on', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const unreadable = { ...h.secrets, read: () => Effect.fail({ detail: sealedElsewhere }) };
    const reason = `The credential of the connection crm cannot be read, so the person who added it removes it and adds it again: ${sealedElsewhere}`;

    const refused = await refusalOf(sourceOf(h, { secrets: unreadable }), id);

    expect(refused).toEqual({ because: 'connection_broken', detail: reason });
    expect((await h.facts()).at(-1)).toMatchObject({
      type: 'connection_broken',
      data: { connection: id, reason },
      context: { by: 'runtime' },
    });
    expect((await connectionOf(sourceOf(h), id)).state).toEqual({
      status: 'unready',
      unready: { because: 'connection_broken', detail: reason },
    });
  });

  it('is broken when the secret store no longer holds its credential', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    await Effect.runPromise(h.secrets.forget('secret-1'));

    expect(await refusalOf(sourceOf(h), id)).toEqual({
      because: 'connection_broken',
      detail:
        'The credential of the connection crm is no longer in the secret store, so the person who added it removes it and adds it again',
    });
  });
});

describe('a connection the rules of the moment no longer allow', () => {
  it('is refused with the sentence of the rule, the one adding it would get, and its credential is not read', async () => {
    const h = harness();
    const id = await connectedCrm(h);
    const unread = { ...h.secrets, read: () => Effect.die(new Error('The credential was read')) };

    const refusals = [
      await refusalOf(sourceOf(h, { ...policyOf({ credential_kinds: ['none'] }), secrets: unread }), id),
      await refusalOf(sourceOf(h, { ...policyOf({ people_may_add: false }), secrets: unread }), id),
      await refusalOf(sourceOf(h, { ...policyOf({ allowed_hosts: ['notes.example.com'] }), secrets: unread }), id),
    ];

    expect(refusals).toEqual([
      {
        because: 'connection_not_allowed',
        detail: 'A connection may not take a secret credential on this runtime, which allows none',
      },
      {
        because: 'connection_not_allowed',
        detail: 'People may not add connections on this runtime: its operator sets up its tool servers itself',
      },
      {
        because: 'connection_not_allowed',
        detail: 'A connection may not reach the host crm.example.com on this runtime, which allows notes.example.com',
      },
    ]);
  });

  it('is refused when it takes a credential not available yet, or its entry is no longer one the runtime takes', async () => {
    const h = harness();
    await recordedDirectly(h, 'consent', { credential: { kind: 'authorization' } });
    await recordedDirectly(h, 'odd', { entry: { url: 'ftp://odd.example.com/mcp' } });
    const source = sourceOf(h);

    expect([await refusalOf(source, 'consent'), await refusalOf(source, 'odd')]).toEqual([
      {
        because: 'connection_not_allowed',
        detail:
          'The authorization credential, a consent the person gives the server, is not available yet; give a secret or client credentials instead',
      },
      {
        because: 'connection_not_allowed',
        detail: 'The entry of the connection odd is not one this runtime takes any more: Expected an http or https URL',
      },
    ]);
  });
});

describe('a connection approved with no credential to give', () => {
  it('is served with none', async () => {
    const h = harness();
    const { id, token } = await added(h, notes);
    await h.call(operationNamed(h.operations, 'approve'), ada, { id, token });

    const { state } = await connectionOf(sourceOf(h), id);

    expect(state.status).toBe('connected');
  });
});
