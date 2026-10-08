import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { defineCommand, defineQuery } from '../index.ts';

const Empty = Schema.Record(Schema.String, Schema.Never);

const probe = {
  name: 'probe',
  title: 'Probe',
  description: 'Probes the definition checks.',
  reasons: [],
  handle: () => Effect.succeed({}),
};

const get: { readonly method: 'GET'; readonly path: '/probe' } = { method: 'GET', path: '/probe' };

const named = Schema.Struct({ name: Schema.String });

interface Tree {
  readonly children: readonly Tree[];
}

const TreeSchema: Schema.Codec<Tree> = Schema.Struct({
  children: Schema.Array(Schema.suspend((): Schema.Codec<Tree> => TreeSchema)),
});

describe('the root of an input or output', () => {
  it('must be an object that declares its fields', () => {
    const undeclared = 'The input of probe must be an object that declares its fields';

    expect(() => defineQuery('brain', { ...probe, route: get, inputSchema: Schema.Any, outputSchema: Empty })).toThrow(
      undeclared,
    );
    expect(() =>
      defineQuery('brain', { ...probe, route: get, inputSchema: Schema.Struct({}), outputSchema: Empty }),
    ).toThrow(undeclared);
    expect(() =>
      defineQuery('brain', {
        ...probe,
        route: get,
        inputSchema: Schema.Record(Schema.String, Schema.String),
        outputSchema: Empty,
      }),
    ).toThrow(undeclared);
    expect(() =>
      defineQuery('brain', {
        ...probe,
        route: get,
        inputSchema: Schema.Union([named, Schema.Record(Schema.String, Schema.Json)]),
        outputSchema: Empty,
      }),
    ).toThrow(undeclared);
    expect(() =>
      defineQuery('brain', { ...probe, route: get, inputSchema: Empty, outputSchema: Schema.Struct({}) }),
    ).toThrow('The output of probe must be an object that declares its fields');
  });
});

describe('an input or output below its root', () => {
  it('may not hold an empty struct at any depth', () => {
    const meta = Schema.Struct({ meta: Schema.Struct({}) });

    expect(() => defineQuery('brain', { ...probe, route: get, inputSchema: meta, outputSchema: Empty })).toThrow(
      'The input of probe holds an empty struct, which accepts any value',
    );
    expect(() =>
      defineQuery('brain', {
        ...probe,
        route: get,
        inputSchema: Empty,
        outputSchema: meta,
        handle: () => Effect.succeed({ meta: {} }),
      }),
    ).toThrow('The output of probe holds an empty struct, which accepts any value');
  });

  it('may be recursive, or a union of objects', () => {
    const shapes = Schema.Union([named, Schema.Struct({ name: Schema.Literal('square'), side: Schema.Finite })]);

    expect(
      defineQuery('brain', {
        ...probe,
        route: get,
        inputSchema: Schema.Struct({ tree: TreeSchema }),
        outputSchema: Empty,
      }).registration.name,
    ).toBe('probe');
    expect(
      defineQuery('brain', {
        ...probe,
        route: { method: 'GET', path: '/probe/{name}' },
        inputSchema: shapes,
        outputSchema: Empty,
      }).registration.pathParameters,
    ).toEqual(['name']);
  });
});

describe('the encoded fields of an input', () => {
  it('may not be named org, nor brain at brain scope, whatever the handler calls them', () => {
    const renaming = Schema.Struct({ organisation: Schema.String, target: Schema.String });

    expect(() =>
      defineQuery('org', {
        ...probe,
        route: get,
        inputSchema: renaming.pipe(Schema.encodeKeys({ organisation: 'org' })),
        outputSchema: Empty,
      }),
    ).toThrow('The input of probe may not have a field named org');
    expect(() =>
      defineQuery('brain', {
        ...probe,
        route: get,
        inputSchema: renaming.pipe(Schema.encodeKeys({ target: 'brain' })),
        outputSchema: Empty,
      }),
    ).toThrow('The input of probe may not have a field named brain');
  });

  it('must carry the brain an org operation targets under the name brain', () => {
    expect(() =>
      defineCommand('org', {
        ...probe,
        route: { method: 'POST', path: '/probe' },
        inputSchema: Schema.Struct({ brain: Schema.String }).pipe(Schema.encodeKeys({ brain: 'target' })),
        outputSchema: Empty,
      }),
    ).toThrow('The input of probe must take its brain field from a field named brain');
  });
});

describe('a route parameter', () => {
  const missing = 'The route parameter name of probe must be a required string field of every input';
  const withName: `/${string}` = '/probe/{name}';

  it('must be a field of every member of the input, even where the compiler cannot see the path', () => {
    expect(() =>
      defineQuery('brain', {
        ...probe,
        route: { method: 'GET', path: withName },
        inputSchema: Empty,
        outputSchema: Empty,
      }),
    ).toThrow(missing);
    expect(() =>
      defineQuery('brain', {
        ...probe,
        route: { method: 'GET', path: withName },
        inputSchema: Schema.Union([named, Schema.Struct({ other: Schema.String })]),
        outputSchema: Empty,
      }),
    ).toThrow(missing);
  });

  it('must be required and a string once encoded', () => {
    const route: { readonly method: 'GET'; readonly path: '/probe/{name}' } = { method: 'GET', path: '/probe/{name}' };

    expect(() =>
      defineQuery('brain', {
        ...probe,
        route: { method: 'GET', path: withName },
        inputSchema: Schema.Struct({ name: Schema.optionalKey(Schema.String) }),
        outputSchema: Empty,
      }),
    ).toThrow(missing);
    expect(() =>
      defineQuery('brain', {
        ...probe,
        route,
        inputSchema: Schema.Struct({ name: Schema.NumberFromString.pipe(Schema.flip) }),
        outputSchema: Empty,
      }),
    ).toThrow(missing);
  });
});

describe('a route parameter that is a string once encoded', () => {
  it('may be any kind of string', () => {
    const route: { readonly method: 'GET'; readonly path: '/brains/{brain}' } = {
      method: 'GET',
      path: '/brains/{brain}',
    };

    expect(
      defineQuery('org', {
        ...probe,
        route,
        inputSchema: Schema.Struct({ brain: Schema.Literals(['alpha', 'beta']) }),
        outputSchema: Empty,
      }).registration,
    ).toMatchObject({ pathParameters: ['brain'], targetsBrain: true });
    expect(
      defineQuery('org', {
        ...probe,
        route,
        inputSchema: Schema.Struct({ brain: Schema.TemplateLiteral(['b-', Schema.String]) }),
        outputSchema: Empty,
      }).registration.targetsBrain,
    ).toBe(true);
  });
});

describe('the declared reasons', () => {
  it('are kept once each', () => {
    expect(
      defineQuery('brain', {
        ...probe,
        route: get,
        inputSchema: Empty,
        outputSchema: Empty,
        reasons: ['not_found', 'not_found'],
      }).registration.reasons,
    ).toEqual(['not_found']);
  });
});

describe('the permissions that let a caller call an operation', () => {
  it('are the one of its kind and scope, or the ones it is permitted by', () => {
    const reading = defineQuery('org', { ...probe, route: get, inputSchema: Empty, outputSchema: Empty });
    const readingInsideABrain = defineQuery('org', {
      ...probe,
      route: get,
      inputSchema: Empty,
      outputSchema: Empty,
      permittedBy: ['org:read', 'brain:read'],
    });

    expect([reading.registration.permissions, readingInsideABrain.registration.permissions]).toEqual([
      ['org:read'],
      ['org:read', 'brain:read'],
    ]);
  });

  it('must be at least one', () => {
    expect(() =>
      defineCommand('org', {
        ...probe,
        route: { method: 'POST', path: '/probe' },
        inputSchema: Empty,
        outputSchema: Empty,
        permittedBy: [],
      }),
    ).toThrow('The operation probe is permitted by no permission');
  });
});
