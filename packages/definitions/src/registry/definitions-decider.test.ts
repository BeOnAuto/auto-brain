import { Conflict, NotFound } from '@beonauto/operations';
import { Result } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DefinitionCommand } from './definition-commands.ts';
import type { DefinitionContent, DefinitionEvent } from './definition-events.ts';
import { definitionsDecider, definitionTypeStreamOf } from './definitions-decider.ts';

const echoDefinitions = definitionsDecider('echo');

const creation = { by: 'acme-admin', at: '2026-10-01T09:00:00.000Z' };

const change = { by: 'acme-editor', at: '2026-10-02T10:30:00.000Z' };

const hello: DefinitionContent = {
  source: '{"greeting": "Hello"}',
  description: 'Greets',
  input_schema: { type: 'object' },
  output_schema: { type: 'object' },
};

const howdy: DefinitionContent = { source: '{"greeting": "Howdy"}' };

const greetCreated: DefinitionEvent = {
  type: 'definition_created',
  name: 'greet',
  version: 1,
  content: hello,
  ...creation,
};

const greetUpdated: DefinitionEvent = {
  type: 'definition_updated',
  name: 'greet',
  version: 2,
  content: howdy,
  ...change,
};

const greetRetired: DefinitionEvent = { type: 'definition_retired', name: 'greet', ...change };

function registryAfter(...events: readonly DefinitionEvent[]) {
  return events.reduce((registry, event) => echoDefinitions.evolve(registry, event), echoDefinitions.initialState);
}

function decided(command: DefinitionCommand, ...history: readonly DefinitionEvent[]) {
  return echoDefinitions.decide(command, registryAfter(...history));
}

const creatingGreet: DefinitionCommand = { type: 'create', name: 'greet', content: hello, ...creation };

function updatingGreet(content: DefinitionContent): DefinitionCommand {
  return { type: 'update', name: 'greet', content, ...change };
}

const retiringGreet: DefinitionCommand = { type: 'retire', name: 'greet', ...change };

describe('creating a definition', () => {
  it('records it at version 1 with its content, who created it and when', () => {
    expect(decided(creatingGreet)).toStrictEqual(Result.succeed([greetCreated]));
  });

  it('is rejected while an active definition holds the name', () => {
    expect(decided(creatingGreet, greetCreated)).toEqual(
      Result.fail(new Conflict({ detail: 'The brain already has the echo definition greet', kind: 'taken' })),
    );
  });

  it('is rejected for the name of a retired definition, because a name is never reused', () => {
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

describe('updating a definition', () => {
  it('records a new version, one more than the last', () => {
    expect(decided(updatingGreet(howdy), greetCreated)).toStrictEqual(Result.succeed([greetUpdated]));
    expect(decided(updatingGreet(hello), greetCreated, greetUpdated)).toStrictEqual(
      Result.succeed([{ type: 'definition_updated', name: 'greet', version: 3, content: hello, ...change }]),
    );
  });

  it('records nothing when the document is the same', () => {
    expect(decided(updatingGreet(hello), greetCreated)).toStrictEqual(Result.succeed([]));
  });

  it('is rejected for a definition the brain does not have', () => {
    expect(decided(updatingGreet(howdy))).toEqual(
      Result.fail(new NotFound({ detail: 'There is no echo definition greet in this brain' })),
    );
  });

  it('is rejected for a retired definition', () => {
    expect(decided(updatingGreet(howdy), greetCreated, greetRetired)).toEqual(
      Result.fail(
        new Conflict({ detail: 'The echo definition greet is retired and can no longer change', kind: 'retired' }),
      ),
    );
  });
});

describe('retiring a definition', () => {
  it('records the retirement of an active definition', () => {
    expect(decided(retiringGreet, greetCreated)).toStrictEqual(Result.succeed([greetRetired]));
  });

  it('records nothing for a definition that is already retired', () => {
    expect(decided(retiringGreet, greetCreated, greetRetired)).toStrictEqual(Result.succeed([]));
  });

  it('is rejected for a definition the brain does not have', () => {
    expect(decided(retiringGreet)).toEqual(
      Result.fail(new NotFound({ detail: 'There is no echo definition greet in this brain' })),
    );
  });
});

describe('the definitions of a capability', () => {
  it('start empty and live in one stream named after the capability', () => {
    expect(echoDefinitions.initialState.size).toBe(0);
    expect(definitionTypeStreamOf('echo')).toBe('definitions/echo');
  });

  it('hold each definition as its events left it, its content replaced by every update', () => {
    const registry = registryAfter(
      greetCreated,
      { type: 'definition_created', name: 'wave', version: 1, content: howdy, ...creation },
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

  it('ignore an event about a definition they never saw created', () => {
    expect(registryAfter(greetUpdated, greetRetired).size).toBe(0);
  });

  it('leave the registry they evolve from untouched', () => {
    const before = registryAfter(greetCreated);

    echoDefinitions.evolve(before, greetRetired);

    expect(before.get('greet')?.status).toBe('active');
  });
});

const threeTriggers: DefinitionContent['triggers'] = [
  { kind: 'event', reference: '/schedule/on', filters: [{ reference: '/schedule/on/one', type: 'x', attributes: {} }] },
  { kind: 'cron', reference: '/schedule/cron', expression: '0 9 * * *' },
  { kind: 'every', reference: '/schedule/every', milliseconds: 60_000 },
];

const reacting: DefinitionContent = { source: '{"greeting": "Hello", "triggers": "three"}', triggers: threeTriggers };

function reactingDefinitions(count: number): readonly DefinitionEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'definition_created',
    name: `reacting-${index}`,
    version: 1,
    content: reacting,
    ...creation,
  }));
}

const beyondTheBound = new Conflict({
  detail:
    'The brain already has 1024 echo definitions that start on their own, the most a brain holds; retire one, or save this one without its schedule',
});

describe('the definitions of a brain that start on their own', () => {
  it('are 1,024 at most, however many triggers each has: one more is refused, created or made so by an update', () => {
    const full = reactingDefinitions(1024);

    expect([
      decided({ ...creatingGreet, content: reacting }, ...full),
      decided(updatingGreet(reacting), greetCreated, ...full),
      decided({ ...creatingGreet, content: hello }, ...full),
    ]).toEqual([Result.fail(beyondTheBound), Result.fail(beyondTheBound), Result.succeed([greetCreated])]);
  });

  it('are counted after a version replaces another, and without the retired ones', () => {
    const almost = reactingDefinitions(1023);
    const retired: DefinitionEvent = { type: 'definition_retired', name: 'reacting-0', ...change };
    const reactingGreet: DefinitionEvent = { ...greetCreated, content: reacting };

    expect([
      Result.isSuccess(
        decided(
          updatingGreet({ ...reacting, source: '{"greeting": "Hi", "triggers": "three"}' }),
          reactingGreet,
          ...almost,
        ),
      ),
      Result.isSuccess(
        decided({ ...creatingGreet, name: 'other', content: reacting }, ...reactingDefinitions(1024), retired),
      ),
    ]).toEqual([true, true]);
  });
});
