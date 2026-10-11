import { Conflict, NotFound } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { PlaybookCommand } from './playbook-commands.ts';
import type { PlaybookEvent } from './playbook-events.ts';
import { registryDecider } from './registry-decider.ts';

const creation = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const change = { by: 'acme-editor', at: '2026-10-02T10:30:00.000Z' };

const alphaCreated: PlaybookEvent = {
  type: 'playbook_created',
  playbook: 'alpha',
  name: 'Alpha',
  description: 'Answers sales questions',
  ...creation,
};

const alphaRetired: PlaybookEvent = { type: 'playbook_retired', playbook: 'alpha', ...change };

function registryAfter(...events: readonly PlaybookEvent[]) {
  return events.reduce((registry, event) => registryDecider.evolve(registry, event), registryDecider.initialState);
}

function decided(command: PlaybookCommand, ...history: readonly PlaybookEvent[]) {
  return registryDecider.decide(command, registryAfter(...history));
}

function updating(name: string, description: string): PlaybookCommand {
  return { type: 'update', playbook: 'alpha', name, description, ...change };
}

const retiring: PlaybookCommand = { type: 'retire', playbook: 'alpha', ...change };

describe('creating a playbook', () => {
  const creating: PlaybookCommand = {
    type: 'create',
    playbook: 'alpha',
    name: 'Alpha',
    description: 'Answers sales questions',
    ...creation,
  };

  it('records the playbook with who created it and when', () => {
    expect(decided(creating)).toStrictEqual(Result.succeed([alphaCreated]));
  });

  it('is rejected while an active playbook holds the id', () => {
    expect(decided(creating, alphaCreated)).toEqual(
      Result.fail(new Conflict({ detail: 'There is already a playbook alpha in this org', kind: 'taken' })),
    );
  });

  it('is rejected for the id of a retired playbook, because an id is never reused', () => {
    expect(decided(creating, alphaCreated, alphaRetired)).toEqual(
      Result.fail(
        new Conflict({ detail: 'The playbook alpha was retired, and a playbook id is never reused', kind: 'taken' }),
      ),
    );
  });
});

describe('updating a playbook', () => {
  it('is rejected for a playbook the org does not have', () => {
    expect(decided(updating('Alpha', ''))).toEqual(
      Result.fail(new NotFound({ detail: 'There is no playbook alpha in this org' })),
    );
  });

  it('is rejected for a retired playbook', () => {
    expect(decided(updating('Alpha Sales', ''), alphaCreated, alphaRetired)).toEqual(
      Result.fail(new Conflict({ detail: 'The playbook alpha is retired and can no longer change', kind: 'retired' })),
    );
  });

  it('records nothing when nothing changes', () => {
    expect(decided(updating('Alpha', 'Answers sales questions'), alphaCreated)).toStrictEqual(Result.succeed([]));
  });

  it('records only the fields that change', () => {
    expect(decided(updating('Alpha Sales', 'Answers sales questions'), alphaCreated)).toStrictEqual(
      Result.succeed([{ type: 'playbook_updated', playbook: 'alpha', name: 'Alpha Sales', ...change }]),
    );
    expect(decided(updating('Alpha', ''), alphaCreated)).toStrictEqual(
      Result.succeed([{ type: 'playbook_updated', playbook: 'alpha', description: '', ...change }]),
    );
    expect(decided(updating('Alpha Sales', ''), alphaCreated)).toStrictEqual(
      Result.succeed([
        { type: 'playbook_updated', playbook: 'alpha', name: 'Alpha Sales', description: '', ...change },
      ]),
    );
  });
});

describe('retiring a playbook', () => {
  it('is rejected for a playbook the org does not have', () => {
    expect(decided(retiring)).toEqual(Result.fail(new NotFound({ detail: 'There is no playbook alpha in this org' })));
  });

  it('records the retirement of an active playbook', () => {
    expect(decided(retiring, alphaCreated)).toStrictEqual(Result.succeed([alphaRetired]));
  });

  it('records nothing for a playbook that is already retired', () => {
    expect(decided(retiring, alphaCreated, alphaRetired)).toStrictEqual(Result.succeed([]));
  });
});

describe("an org's playbook registry", () => {
  it('starts empty', () => {
    expect(registryDecider.initialState.size).toBe(0);
  });

  it('holds each playbook as its facts left it', () => {
    const registry = registryAfter(
      alphaCreated,
      { type: 'playbook_created', playbook: 'beta', name: 'Beta', description: '', ...creation },
      { type: 'playbook_updated', playbook: 'alpha', name: 'Alpha Sales', ...change },
      { type: 'playbook_updated', playbook: 'beta', description: 'Handles support', ...change },
      { ...alphaRetired, at: '2026-10-03T08:00:00.000Z' },
    );

    expect([...registry.values()]).toStrictEqual([
      {
        id: 'alpha',
        name: 'Alpha Sales',
        description: 'Answers sales questions',
        status: 'retired',
        created_at: '2026-10-01T09:00:00.000Z',
        created_by: 'acme-admin',
        updated_at: '2026-10-03T08:00:00.000Z',
        retired_at: '2026-10-03T08:00:00.000Z',
      },
      {
        id: 'beta',
        name: 'Beta',
        description: 'Handles support',
        status: 'active',
        created_at: '2026-10-01T09:00:00.000Z',
        created_by: 'acme-admin',
        updated_at: '2026-10-02T10:30:00.000Z',
      },
    ]);
  });
});

describe('a fact', () => {
  it('about a playbook the registry never saw created leaves the registry as it was', () => {
    expect(
      registryAfter(alphaRetired, { type: 'playbook_updated', playbook: 'alpha', name: 'Ghost', ...change }).size,
    ).toBe(0);
  });

  it('leaves the registry it evolves from untouched', () => {
    const before = registryAfter(alphaCreated);

    registryDecider.evolve(before, alphaRetired);

    expect(before.get('alpha')?.status).toBe('active');
  });
});
