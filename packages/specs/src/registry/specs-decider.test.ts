import { Conflict, NotFound } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { SpecCommand } from './spec-commands.ts';
import type { SpecContent, SpecEvent } from './spec-events.ts';
import { specsDecider, specsStreamOf } from './specs-decider.ts';

const echoSpecs = specsDecider('echo');

const creation = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const change = { by: 'acme-editor', at: '2026-10-02T10:30:00.000Z' };

const hello: SpecContent = {
  source: '{"greeting": "Hello"}',
  description: 'Greets',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
};

const howdy: SpecContent = { source: '{"greeting": "Howdy"}' };

const greetCreated: SpecEvent = { type: 'spec_created', name: 'greet', version: 1, content: hello, ...creation };

const greetUpdated: SpecEvent = { type: 'spec_updated', name: 'greet', version: 2, content: howdy, ...change };

const greetRetired: SpecEvent = { type: 'spec_retired', name: 'greet', ...change };

function registryAfter(...events: readonly SpecEvent[]) {
  return events.reduce((registry, event) => echoSpecs.evolve(registry, event), echoSpecs.initialState);
}

function decided(command: SpecCommand, ...history: readonly SpecEvent[]) {
  return echoSpecs.decide(command, registryAfter(...history));
}

const creatingGreet: SpecCommand = { type: 'create', name: 'greet', content: hello, ...creation };

function updatingGreet(content: SpecContent): SpecCommand {
  return { type: 'update', name: 'greet', content, ...change };
}

const retiringGreet: SpecCommand = { type: 'retire', name: 'greet', ...change };

describe('creating a spec', () => {
  it('records it at version 1 with its content, who created it and when', () => {
    expect(decided(creatingGreet)).toStrictEqual(Result.succeed([greetCreated]));
  });

  it('is rejected while an active spec holds the name', () => {
    expect(decided(creatingGreet, greetCreated)).toEqual(
      Result.fail(new Conflict({ detail: 'The brain already has the echo definition greet', kind: 'taken' })),
    );
  });

  it('is rejected for the name of a retired spec, because a name is never reused', () => {
    expect(decided(creatingGreet, greetCreated, greetRetired)).toEqual(
      Result.fail(
        new Conflict({
          detail: 'The echo definition greet was retired, and a definition name is never reused',
          kind: 'taken',
        }),
      ),
    );
  });
});

describe('updating a spec', () => {
  it('records a new version, one more than the last', () => {
    expect(decided(updatingGreet(howdy), greetCreated)).toStrictEqual(Result.succeed([greetUpdated]));
    expect(decided(updatingGreet(hello), greetCreated, greetUpdated)).toStrictEqual(
      Result.succeed([{ type: 'spec_updated', name: 'greet', version: 3, content: hello, ...change }]),
    );
  });

  it('records nothing when the document is the same', () => {
    expect(decided(updatingGreet(hello), greetCreated)).toStrictEqual(Result.succeed([]));
  });

  it('is rejected for a spec the brain does not have', () => {
    expect(decided(updatingGreet(howdy))).toEqual(
      Result.fail(new NotFound({ detail: 'There is no echo definition greet in this brain' })),
    );
  });

  it('is rejected for a retired spec', () => {
    expect(decided(updatingGreet(howdy), greetCreated, greetRetired)).toEqual(
      Result.fail(
        new Conflict({ detail: 'The echo definition greet is retired and can no longer change', kind: 'retired' }),
      ),
    );
  });
});

describe('retiring a spec', () => {
  it('records the retirement of an active spec', () => {
    expect(decided(retiringGreet, greetCreated)).toStrictEqual(Result.succeed([greetRetired]));
  });

  it('records nothing for a spec that is already retired', () => {
    expect(decided(retiringGreet, greetCreated, greetRetired)).toStrictEqual(Result.succeed([]));
  });

  it('is rejected for a spec the brain does not have', () => {
    expect(decided(retiringGreet)).toEqual(
      Result.fail(new NotFound({ detail: 'There is no echo definition greet in this brain' })),
    );
  });
});

describe('the specs of a primitive', () => {
  it('start empty and live in one stream named after the primitive', () => {
    expect(echoSpecs.initialState.size).toBe(0);
    expect(specsStreamOf('echo')).toBe('specs/echo');
  });

  it('hold each spec as its events left it, its content replaced by every update', () => {
    const registry = registryAfter(
      greetCreated,
      { type: 'spec_created', name: 'wave', version: 1, content: howdy, ...creation },
      greetUpdated,
      { ...greetRetired, at: '2026-10-03T08:00:00.000Z' },
    );

    expect([...registry.values()]).toStrictEqual([
      {
        name: 'greet',
        version: 2,
        status: 'retired',
        source: '{"greeting": "Howdy"}',
        created_at: '2026-10-01T09:00:00.000Z',
        created_by: 'acme-admin',
        updated_at: '2026-10-03T08:00:00.000Z',
        retired_at: '2026-10-03T08:00:00.000Z',
      },
      {
        name: 'wave',
        version: 1,
        status: 'active',
        source: '{"greeting": "Howdy"}',
        created_at: '2026-10-01T09:00:00.000Z',
        created_by: 'acme-admin',
        updated_at: '2026-10-01T09:00:00.000Z',
      },
    ]);
  });

  it('ignore an event about a spec they never saw created', () => {
    expect(registryAfter(greetUpdated, greetRetired).size).toBe(0);
  });

  it('leave the registry they evolve from untouched', () => {
    const before = registryAfter(greetCreated);

    echoSpecs.evolve(before, greetRetired);

    expect(before.get('greet')?.status).toBe('active');
  });
});
