import { Conflict, NotFound } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { BrainCommand } from './brain-commands.ts';
import type { BrainEvent } from './brain-events.ts';
import { registryDecider } from './registry-decider.ts';

const creation = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const change = { by: 'acme-editor', at: '2026-10-02T10:30:00.000Z' };

const alphaCreated: BrainEvent = {
  type: 'brain_created',
  brain: 'alpha',
  name: 'Alpha',
  description: 'Answers sales questions',
  ...creation,
};

const alphaRetired: BrainEvent = { type: 'brain_retired', brain: 'alpha', ...change };

function registryAfter(...events: readonly BrainEvent[]) {
  return events.reduce((registry, event) => registryDecider.evolve(registry, event), registryDecider.initialState);
}

function decided(command: BrainCommand, ...history: readonly BrainEvent[]) {
  return registryDecider.decide(command, registryAfter(...history));
}

function updating(name: string, description: string): BrainCommand {
  return { type: 'update', brain: 'alpha', name, description, ...change };
}

const retiring: BrainCommand = { type: 'retire', brain: 'alpha', ...change };

describe('creating a brain', () => {
  const creating: BrainCommand = {
    type: 'create',
    brain: 'alpha',
    name: 'Alpha',
    description: 'Answers sales questions',
    ...creation,
  };

  it('records the brain with who created it and when', () => {
    expect(decided(creating)).toStrictEqual(Result.succeed([alphaCreated]));
  });

  it('is rejected while an active brain holds the id', () => {
    expect(decided(creating, alphaCreated)).toEqual(
      Result.fail(new Conflict({ detail: 'There is already a brain alpha in this org', kind: 'taken' })),
    );
  });

  it('is rejected for the id of a retired brain, because an id is never reused', () => {
    expect(decided(creating, alphaCreated, alphaRetired)).toEqual(
      Result.fail(
        new Conflict({ detail: 'The brain alpha was retired, and a brain id is never reused', kind: 'taken' }),
      ),
    );
  });
});

describe('updating a brain', () => {
  it('is rejected for a brain the org does not have', () => {
    expect(decided(updating('Alpha', ''))).toEqual(
      Result.fail(new NotFound({ detail: 'There is no brain alpha in this org' })),
    );
  });

  it('is rejected for a retired brain', () => {
    expect(decided(updating('Alpha Sales', ''), alphaCreated, alphaRetired)).toEqual(
      Result.fail(new Conflict({ detail: 'The brain alpha is retired and can no longer change', kind: 'retired' })),
    );
  });

  it('records nothing when nothing changes', () => {
    expect(decided(updating('Alpha', 'Answers sales questions'), alphaCreated)).toStrictEqual(Result.succeed([]));
  });

  it('records only the fields that change', () => {
    expect(decided(updating('Alpha Sales', 'Answers sales questions'), alphaCreated)).toStrictEqual(
      Result.succeed([{ type: 'brain_updated', brain: 'alpha', name: 'Alpha Sales', ...change }]),
    );
    expect(decided(updating('Alpha', ''), alphaCreated)).toStrictEqual(
      Result.succeed([{ type: 'brain_updated', brain: 'alpha', description: '', ...change }]),
    );
    expect(decided(updating('Alpha Sales', ''), alphaCreated)).toStrictEqual(
      Result.succeed([{ type: 'brain_updated', brain: 'alpha', name: 'Alpha Sales', description: '', ...change }]),
    );
  });
});

describe('retiring a brain', () => {
  it('is rejected for a brain the org does not have', () => {
    expect(decided(retiring)).toEqual(Result.fail(new NotFound({ detail: 'There is no brain alpha in this org' })));
  });

  it('records the retirement of an active brain', () => {
    expect(decided(retiring, alphaCreated)).toStrictEqual(Result.succeed([alphaRetired]));
  });

  it('records nothing for a brain that is already retired', () => {
    expect(decided(retiring, alphaCreated, alphaRetired)).toStrictEqual(Result.succeed([]));
  });
});

describe("an org's brain registry", () => {
  it('starts empty', () => {
    expect(registryDecider.initialState.size).toBe(0);
  });

  it('holds each brain as its facts left it', () => {
    const registry = registryAfter(
      alphaCreated,
      { type: 'brain_created', brain: 'beta', name: 'Beta', description: '', ...creation },
      { type: 'brain_updated', brain: 'alpha', name: 'Alpha Sales', ...change },
      { type: 'brain_updated', brain: 'beta', description: 'Handles support', ...change },
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
  it('about a brain the registry never saw created leaves the registry as it was', () => {
    expect(registryAfter(alphaRetired, { type: 'brain_updated', brain: 'alpha', name: 'Ghost', ...change }).size).toBe(
      0,
    );
  });

  it('leaves the registry it evolves from untouched', () => {
    const before = registryAfter(alphaCreated);

    registryDecider.evolve(before, alphaRetired);

    expect(before.get('alpha')?.status).toBe('active');
  });
});
