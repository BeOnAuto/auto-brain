import type { Registration } from '@beonauto/operations';
import { describe, expect, it } from 'vitest';

import { makeSpecOperations } from '../index.ts';
import { echo } from '../testing/echo.ts';
import { probe } from '../testing/probe.ts';

const operations = makeSpecOperations([echo, probe().primitive]);

function registrationOf(name: string): Registration {
  const found = operations.find(({ registration }) => registration.name === name);
  if (found === undefined) {
    throw new Error(`There is no operation ${name}`);
  }
  return found.registration;
}

function outcomeOf(name: string, output: unknown, input: unknown): string | undefined {
  return registrationOf(name).plainLanguage?.outcome(output, input);
}

function attemptOf(name: string, input: unknown): string | undefined {
  return registrationOf(name).plainLanguage?.attempt(input);
}

const greet = {
  primitive: 'echo',
  name: 'greet',
  version: 1,
  status: 'active',
  media_type: 'application/json',
  source: '{"greeting":"Hello"}',
  created_at: '2026-10-02T09:00:00.000Z',
  created_by: 'acme-admin',
  updated_at: '2026-10-02T09:00:00.000Z',
};

const greetInput = { primitive: 'echo', name: 'greet', source: '{"greeting":"Hello"}' };

function listed(spec: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(spec).filter(([key]: readonly [string, unknown]) => key !== 'source'));
}

const describing: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>, string]> = [
  ['its description', { description: 'Greets the caller' }, ' What it does: Greets the caller.'],
  [
    'what it takes and gives back',
    {
      input_schema: { type: 'object', properties: { customer_name: { type: 'string' } } },
      output_schema: { type: 'object', properties: { greeting: {}, sentAt: {} } },
    },
    ' It takes customer name, and gives back greeting and sent at.',
  ],
  ['only what it takes', { input_schema: { properties: { text: {} } } }, ' It takes text.'],
  ['only what it gives back', { output_schema: { properties: { verdict: {} } } }, ' It gives back verdict.'],
  ['nothing when its schemas name no fields', { input_schema: { type: 'object' } }, ''],
];

describe('the plain language of create_spec', () => {
  it.each(describing)('says what the new spec does from %s', (_case, content, words) => {
    expect(outcomeOf('create_spec', { ...greet, ...content }, greetInput)).toBe(
      `Created the greeting “greet”.${words} It has been saved but has not been run yet.`,
    );
  });

  it('names the spec it tried to create in the words of its primitive, or what it tried', () => {
    expect([
      attemptOf('create_spec', greetInput),
      attemptOf('create_spec', { ...greetInput, primitive: 'nowhere' }),
      attemptOf('create_spec', { name: 'greet' }),
    ]).toEqual(['create the greeting “greet”', 'create the item “greet”', 'create a new greeting or probe']);
  });
});

describe('the plain language of update_spec', () => {
  it('says the change applies from the next run', () => {
    expect(outcomeOf('update_spec', { ...greet, version: 2, description: 'Greets' }, greetInput)).toBe(
      'Updated the greeting “greet”. What it does: Greets. The change applies from its next run.',
    );
  });

  it('names the spec it tried to update', () => {
    expect([attemptOf('update_spec', greetInput), attemptOf('update_spec', {})]).toEqual([
      'update the greeting “greet”',
      'update a greeting or probe',
    ]);
  });
});

describe('the plain language of get_spec', () => {
  it('says whether the spec is in use and what it does', () => {
    expect([
      outcomeOf('get_spec', { ...greet, description: 'Greets' }, { primitive: 'echo', name: 'greet' }),
      outcomeOf('get_spec', { ...greet, status: 'retired' }, { primitive: 'echo', name: 'greet' }),
    ]).toEqual([
      'The greeting “greet” is in use. What it does: Greets.',
      'The greeting “greet” has been retired; it can no longer be run or changed.',
    ]);
  });

  it('names the spec it looked for', () => {
    expect([attemptOf('get_spec', { primitive: 'probe', name: 'plain' }), attemptOf('get_spec', {})]).toEqual([
      'look up the probe “plain”',
      'look up a greeting or probe',
    ]);
  });
});

function greeting(name: string, status = 'active'): Readonly<Record<string, unknown>> {
  return listed({ ...greet, name, status });
}

const specListings: ReadonlyArray<readonly [readonly unknown[], string]> = [
  [[], 'This brain has no greetings in use yet.'],
  [[greeting('greet')], 'This brain has 1 greeting: “greet”.'],
  [[greeting('greet'), greeting('wave')], 'This brain has 2 greetings: “greet” and “wave”.'],
  [
    [greeting('greet'), greeting('old', 'retired')],
    'This brain has 1 greeting: “greet”. Also listed, 1 retired greeting: “old”.',
  ],
];

describe('the plain language of list_specs', () => {
  it.each(specListings)('describes %j', (specs, words) => {
    expect(outcomeOf('list_specs', { specs }, { primitive: 'echo' })).toBe(words);
  });

  it('names at most twenty specs and counts the rest', () => {
    const specs = Array.from({ length: 21 }, (_, index) => greeting(`greet-${index}`));

    expect(outcomeOf('list_specs', { specs }, { primitive: 'echo' })).toMatch(/“greet-19”, and 1 more\.$/u);
  });

  it('names the kind of spec it tried to list', () => {
    expect([attemptOf('list_specs', { primitive: 'probe' }), attemptOf('list_specs', {})]).toEqual([
      'list the probes',
      'list the greetings and probes',
    ]);
  });
});

describe('the plain language of retire_spec', () => {
  it('says the spec can no longer be run or changed, nor its name used again', () => {
    expect(outcomeOf('retire_spec', { ...greet, status: 'retired' }, { primitive: 'echo', name: 'greet' })).toBe(
      'Retired the greeting “greet”. It can no longer be run or changed, and its name cannot be used again in this brain.',
    );
  });

  it('names the spec it tried to retire', () => {
    expect([attemptOf('retire_spec', { primitive: 'echo', name: 'greet' }), attemptOf('retire_spec', {})]).toEqual([
      'retire the greeting “greet”',
      'retire a greeting or probe',
    ]);
  });
});
