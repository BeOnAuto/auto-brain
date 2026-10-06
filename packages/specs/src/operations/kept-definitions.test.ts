import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { definePrimitive, type Primitive, type StandingRequest } from '../index.ts';
import { specsDecider, specsStreamOf } from '../registry/specs-decider.ts';
import { acmeAdmin } from '../testing/callers.ts';
import { harness, toBrain } from '../testing/harness.ts';
import { probe } from '../testing/probe.ts';
import { specOperationsFor } from '../testing/spec-operations.ts';

const toAlpha = toBrain('acme', 'alpha');

function keeper(mostActive: number): Primitive {
  return definePrimitive({
    name: 'keeper',
    title: 'Keeper',
    description: 'Keeps what its document says, for a host to read from the definition record.',
    noun: { one: 'keeper', other: 'keepers' },
    describeOutput: () => 'It kept.',
    mediaType: 'text/plain',
    parse: (source: string) => Effect.succeed({ kept: source }),
    summarize: ({ kept }) => ({ description: 'Keeps a text', details: { kept, line: 4 } }),
    execute: () => Effect.succeed({ output: null, record: {} }),
    mostActive,
    standing: ({ org, brain, name, version, status }: StandingRequest) =>
      Effect.succeed(name === 'unkept' ? undefined : { state: 'live', of: `${org}/${brain}/${name}`, version, status }),
  });
}

function keepersOf(primitive: Primitive) {
  const specs = harness();
  const { createSpec, getSpec, listSpecs, updateSpec, retireSpec } = specOperationsFor([primitive, probe().primitive]);
  const create = (name: string) =>
    specs.call(createSpec, toAlpha(acmeAdmin, { primitive: 'keeper', name, source: name }));
  return { specs, create, getSpec, listSpecs, updateSpec, retireSpec };
}

describe('what a definition keeps for its runtime adapter', () => {
  it('is stored with its record and kept in the state of its registry, never in what an operation answers', async () => {
    const { specs, create, getSpec, listSpecs } = keepersOf(keeper(32));

    const created = await create('reviews');
    const read = await specs.call(getSpec, toAlpha(acmeAdmin, { primitive: 'keeper', name: 'reviews' }));
    const listed = await specs.call(listSpecs, toAlpha(acmeAdmin, { primitive: 'keeper' }));
    const { state } = await Effect.runPromise(
      specs.ledger.service.load(`brain/acme/alpha/${specsStreamOf('keeper')}`, specsDecider('keeper')),
    );

    expect(state.get('reviews')?.details).toEqual({ kept: 'reviews', line: 4 });
    for (const outcome of [created, read]) {
      expect(outcome).toMatchObject({ status: 'succeeded', output: { name: 'reviews' } });
      expect(outcome).not.toHaveProperty('output.details');
    }
    expect(listed).not.toHaveProperty('output.specs.0.details');
  });
});

describe('the standing of a definition', () => {
  it('is answered by get_spec from its runtime adapter, given the brain, the name, the version and the status', async () => {
    const { specs, create, getSpec } = keepersOf(keeper(32));
    await create('reviews');
    await create('unkept');

    const read = await specs.call(getSpec, toAlpha(acmeAdmin, { primitive: 'keeper', name: 'reviews' }));
    const unkept = await specs.call(getSpec, toAlpha(acmeAdmin, { primitive: 'keeper', name: 'unkept' }));

    expect(read).toMatchObject({
      output: { standing: { state: 'live', of: 'acme/alpha/reviews', version: 1, status: 'active' } },
    });
    expect(unkept).not.toHaveProperty('output.standing');
  });
});

describe('the active definitions of a type a brain may keep', () => {
  it('refuse a definition past their bound as a conflict, and take one again once another is retired', async () => {
    const { specs, create, retireSpec } = keepersOf(keeper(2));
    await create('first');
    await create('second');

    const third = await create('third');
    await specs.call(retireSpec, toAlpha(acmeAdmin, { primitive: 'keeper', name: 'first' }));
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
    const updated = await before.specs.call(
      before.updateSpec,
      toAlpha(acmeAdmin, { primitive: 'keeper', name: 'first', source: 'changed' }),
    );
    const lowered = specOperationsFor([keeper(1)]);

    const refused = await before.specs.call(
      lowered.updateSpec,
      toAlpha(acmeAdmin, { primitive: 'keeper', name: 'first', source: 'again' }),
    );
    const retired = await before.specs.call(
      lowered.retireSpec,
      toAlpha(acmeAdmin, { primitive: 'keeper', name: 'first' }),
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
