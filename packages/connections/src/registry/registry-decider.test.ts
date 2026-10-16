import { NotFound, recordingOf } from '@on.auto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { ConnectionCommand } from './connection-commands.ts';
import type { ConnectionEvent } from './connection-events.ts';
import { connectionsStreamOfOrg, registryDecider } from './registry-decider.ts';

const recorded = recordingOf(registryDecider.eventSchema);

const acted = { by: 'person:ada', at: '2026-10-15T14:00:00.000Z' };

const crmAdded: ConnectionEvent = {
  type: 'connection_added',
  data: {
    connection: 'crm-id',
    name: 'crm',
    kind: 'mcp',
    entry: { url: 'https://crm.example.com/mcp' },
    credential: { kind: 'none' },
  },
};

function decided(command: ConnectionCommand, ...history: readonly ConnectionEvent[]) {
  const registry = history.reduce(
    (state, event) => registryDecider.evolve(state, recorded(event, acted)),
    registryDecider.initialState,
  );
  return registryDecider.decide(command, registry);
}

function breaking(reason: string): ConnectionCommand {
  return { type: 'break', connection: 'crm-id', reason, ...acted };
}

const lostKey = 'Its credential was sealed under a secret key the runtime no longer has';

describe('breaking a connection', () => {
  it('records the sentence of why, with who and when as its context', () => {
    expect(decided(breaking(lostKey), crmAdded)).toStrictEqual(
      Result.succeed([{ type: 'connection_broken', data: { connection: 'crm-id', reason: lostKey } }]),
    );
    expect(registryDecider.context(breaking(lostKey), registryDecider.initialState)).toStrictEqual(acted);
  });

  it('records nothing when it is broken for that reason already, or removed, and refuses an unknown connection', () => {
    const broken: ConnectionEvent = { type: 'connection_broken', data: { connection: 'crm-id', reason: lostKey } };
    const removed: ConnectionEvent = { type: 'connection_removed', data: { connection: 'crm-id' } };

    expect(decided(breaking(lostKey), crmAdded, broken)).toStrictEqual(Result.succeed([]));
    expect(decided(breaking(lostKey), crmAdded, removed)).toStrictEqual(Result.succeed([]));
    expect(decided(breaking(lostKey))).toStrictEqual(
      Result.fail(new NotFound({ detail: 'There is no connection crm-id in this org' })),
    );
  });
});

describe('giving a credential to a connection that takes none', () => {
  it('is refused, though the link is open', () => {
    const linkIssued: ConnectionEvent = {
      type: 'connection_link_issued',
      data: { connection: 'crm-id', token_sha256: 'a1b2', expires_at: '2026-10-15T14:10:00.000Z' },
    };
    const giving: ConnectionCommand = {
      type: 'give',
      connection: 'crm-id',
      token_sha256: 'a1b2',
      bindsPerson: true,
      secret_id: 'secret-1',
      ...acted,
    };

    expect(decided(giving, crmAdded, linkIssued)).toMatchObject(
      Result.fail({ detail: 'The connection crm takes no credential to give, so it is approved as it is' }),
    );
  });
});

describe('the stream of the connections of an org', () => {
  it('is named under the org, beside its playbooks', () => {
    expect(connectionsStreamOfOrg('acme')).toBe('org/acme/connections');
  });
});
