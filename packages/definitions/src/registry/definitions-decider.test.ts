import { Conflict, NotFound, type Context, type Recorded } from '@beonauto/operations';
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

type RecordedDefinition = Recorded<DefinitionEvent>;

function ofTheDefinition(name: string, when: Pick<Context, 'by' | 'at'>, version?: number): Context {
  return {
    ...when,
    definitionType: 'echo',
    definitionName: name,
    ...(version === undefined ? {} : { definitionVersion: version }),
  };
}

function created(name: string, content: DefinitionContent): RecordedDefinition {
  return { type: 'definition_created', data: { content }, context: ofTheDefinition(name, creation, 1) };
}

const greetCreated = created('greet', hello);

const greetUpdated: RecordedDefinition = {
  type: 'definition_updated',
  data: { content: howdy },
  context: ofTheDefinition('greet', change, 2),
};

function retired(name: string, at = change.at): RecordedDefinition {
  return { type: 'definition_retired', data: {}, context: ofTheDefinition(name, { ...change, at }) };
}

const greetRetired = retired('greet');

function registryAfter(...events: readonly RecordedDefinition[]) {
  return events.reduce((registry, event) => echoDefinitions.evolve(registry, event), echoDefinitions.initialState);
}

function decided(command: DefinitionCommand, ...history: readonly RecordedDefinition[]) {
  return echoDefinitions.decide(command, registryAfter(...history));
}

function contextOf(command: DefinitionCommand, ...history: readonly RecordedDefinition[]) {
  return echoDefinitions.context(command, registryAfter(...history));
}

const creatingGreet: DefinitionCommand = { type: 'create', name: 'greet', content: hello, ...creation };

function updatingGreet(content: DefinitionContent): DefinitionCommand {
  return { type: 'update', name: 'greet', content, ...change };
}

const retiringGreet: DefinitionCommand = { type: 'retire', name: 'greet', ...change };

describe('creating a definition', () => {
  it('records its content, with the definition at version 1, who created it and when as its context', () => {
    expect(decided(creatingGreet)).toStrictEqual(
      Result.succeed([{ type: 'definition_created', data: { content: hello } }]),
    );
    expect(contextOf(creatingGreet)).toStrictEqual(greetCreated.context);
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
  it('records a new version, one more than the last, as its context', () => {
    expect(decided(updatingGreet(howdy), greetCreated)).toStrictEqual(
      Result.succeed([{ type: 'definition_updated', data: { content: howdy } }]),
    );
    expect([
      contextOf(updatingGreet(howdy), greetCreated),
      contextOf(updatingGreet(hello), greetCreated, greetUpdated),
      contextOf(updatingGreet(hello)),
    ]).toStrictEqual([greetUpdated.context, ofTheDefinition('greet', change, 3), ofTheDefinition('greet', change, 1)]);
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
  it('records the retirement of an active definition, with no version in its context', () => {
    expect(decided(retiringGreet, greetCreated)).toStrictEqual(
      Result.succeed([{ type: 'definition_retired', data: {} }]),
    );
    expect(contextOf(retiringGreet, greetCreated)).toStrictEqual(greetRetired.context);
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
      created('wave', howdy),
      greetUpdated,
      retired('greet', '2026-10-03T08:00:00.000Z'),
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
});

describe('the definitions of a capability, from what their facts say', () => {
  it('hold a fact recorded without its name or version as a definition of no name at the next version', () => {
    const registry = registryAfter({ ...greetCreated, context: creation }, { ...greetUpdated, context: { ...change } });

    expect([...registry.values()]).toMatchObject([{ name: '', version: 2 }]);
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

function reactingDefinitions(count: number): readonly RecordedDefinition[] {
  return Array.from({ length: count }, (_, index) => created(`reacting-${index}`, reacting));
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
    ]).toEqual([
      Result.fail(beyondTheBound),
      Result.fail(beyondTheBound),
      Result.succeed([{ type: 'definition_created', data: { content: hello } }]),
    ]);
  });

  it('are counted after a version replaces another, and without the retired ones', () => {
    const almost = reactingDefinitions(1023);
    const reactingGreet = created('greet', reacting);

    expect([
      Result.isSuccess(
        decided(
          updatingGreet({ ...reacting, source: '{"greeting": "Hi", "triggers": "three"}' }),
          reactingGreet,
          ...almost,
        ),
      ),
      Result.isSuccess(
        decided(
          { ...creatingGreet, name: 'other', content: reacting },
          ...reactingDefinitions(1024),
          retired('reacting-0'),
        ),
      ),
    ]).toEqual([true, true]);
  });
});
