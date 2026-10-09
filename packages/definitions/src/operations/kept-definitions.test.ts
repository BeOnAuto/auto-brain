import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCapability, type Capability, type StandingRequest } from '../index.ts';
import { definitionsDecider, definitionTypeStreamOf } from '../registry/definitions-decider.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { definitionOperationsFor } from '../testing/definition-operations.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';

const toAlpha = toBrain('acme', 'alpha');

function keeper(mostActive: number): Capability {
  return defineCapability({
    type: 'keeper',
    title: 'Keeper',
    guide: { name: 'keeper' },
    noun: { one: 'keeper', other: 'keepers' },
    describeOutput: () => 'It kept.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed({ kept: source }),
    summarize: ({ kept }) => ({ description: 'Keeps a text', details: { kept, line: 4 } }),
    run: () => Effect.succeed({ output: null, record: {} }),
    mostActive,
    standing: ({ org, brain, name, version, status }: StandingRequest) =>
      Effect.succeed(name === 'unkept' ? undefined : { state: 'live', of: `${org}/${brain}/${name}`, version, status }),
  });
}

function keepersOf(capability: Capability) {
  const definitions = harness();
  const { createDefinition, getDefinition, listDefinitions, updateDefinition, retireDefinition } =
    definitionOperationsFor([capability, probe().capability]);
  const create = (name: string) =>
    definitions.call(createDefinition, toAlpha(acmeAdmin, { type: 'keeper', name, source: name }));
  return { definitions, create, getDefinition, listDefinitions, updateDefinition, retireDefinition };
}

describe('what a definition keeps for its runtime adapter', () => {
  it('is stored with its record and kept in the state of its registry, never in what an operation answers', async () => {
    const { definitions, create, getDefinition, listDefinitions } = keepersOf(keeper(32));

    const created = await create('reviews');
    const read = await definitions.call(getDefinition, toAlpha(acmeAdmin, { type: 'keeper', name: 'reviews' }));
    const listed = await definitions.call(listDefinitions, toAlpha(acmeAdmin, { type: 'keeper' }));
    const { state } = await Effect.runPromise(
      definitions.ledger.service.load(
        `brain/acme/alpha/${definitionTypeStreamOf('keeper')}`,
        definitionsDecider('keeper'),
      ),
    );

    expect(state.get('reviews')?.details).toEqual({ kept: 'reviews', line: 4 });
    for (const outcome of [created, read]) {
      expect(outcome).toMatchObject({ status: 'succeeded', output: { name: 'reviews' } });
      expect(outcome).not.toHaveProperty('output.details');
    }
    expect(listed).not.toHaveProperty('output.definitions.0.details');
  });
});

describe('the standing of a definition', () => {
  it('is answered by get_definition from its runtime adapter, given the brain, the name, the version and the status', async () => {
    const { definitions, create, getDefinition } = keepersOf(keeper(32));
    await create('reviews');
    await create('unkept');

    const read = await definitions.call(getDefinition, toAlpha(acmeAdmin, { type: 'keeper', name: 'reviews' }));
    const unkept = await definitions.call(getDefinition, toAlpha(acmeAdmin, { type: 'keeper', name: 'unkept' }));

    expect(read).toMatchObject({
      output: { standing: { state: 'live', of: 'acme/alpha/reviews', version: 1, status: 'active' } },
    });
    expect(unkept).not.toHaveProperty('output.standing');
  });
});

describe('the active definitions of a type a brain may keep', () => {
  it('refuse a definition past their bound as a conflict, and take one again once another is retired', async () => {
    const { definitions, create, retireDefinition } = keepersOf(keeper(2));
    await create('first');
    await create('second');

    const third = await create('third');
    await definitions.call(retireDefinition, toAlpha(acmeAdmin, { type: 'keeper', name: 'first' }));
    const again = await create('third');

    expect(third).toEqual({
      status: 'rejected',
      reason: 'conflict',
      detail:
        'The brain keeps 2 active keeper definitions, and a brain may keep at most 2; retire one before creating another',
    });
    expect(again).toMatchObject({ status: 'succeeded' });
  });

  it('let a definition at the bound be updated, but refuse every save once the bound is lowered below them', async () => {
    const before = keepersOf(keeper(2));
    await before.create('first');
    await before.create('second');
    const updated = await before.definitions.call(
      before.updateDefinition,
      toAlpha(acmeAdmin, { type: 'keeper', name: 'first', source: 'changed' }),
    );
    const lowered = definitionOperationsFor([keeper(1)]);

    const refused = await before.definitions.call(
      lowered.updateDefinition,
      toAlpha(acmeAdmin, { type: 'keeper', name: 'first', source: 'again' }),
    );
    const retired = await before.definitions.call(
      lowered.retireDefinition,
      toAlpha(acmeAdmin, { type: 'keeper', name: 'first' }),
    );

    expect(updated).toMatchObject({ status: 'succeeded', output: { version: 2 } });
    expect(refused).toMatchObject({
      reason: 'conflict',
      detail:
        'The brain keeps 2 active keeper definitions, and a brain may keep at most 1; retire one before saving another version',
    });
    expect(retired).toMatchObject({ status: 'succeeded', output: { status: 'retired' } });
  });
});
