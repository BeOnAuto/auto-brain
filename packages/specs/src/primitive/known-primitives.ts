import { NotFound } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { isPrimitiveName, type Primitive } from './primitive.ts';

function primitiveFieldOf(names: readonly string[]) {
  return Schema.String.annotate({
    description: `The name of the primitive the spec belongs to: ${names.join(', ')}`,
  }).check(
    Schema.makeFilter(isPrimitiveName, {
      expected: 'a primitive name: 3 to 32 lowercase letters, digits and hyphens, starting with a letter',
      toJsonSchema: () => ({ enum: [...names] }),
    }),
  );
}

export interface KnownPrimitives {
  readonly field: ReturnType<typeof primitiveFieldOf>;
  readonly describe: (sentences: readonly string[]) => string;
  readonly primitiveNamed: (name: string) => Effect.Effect<Primitive, NotFound>;
}

function requireSomePrimitive(names: readonly string[]): void {
  if (names.length === 0) {
    throw new Error('The spec operations need at least one primitive');
  }
}

function requireDistinctNames(names: readonly string[]): void {
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated !== undefined) {
    throw new Error(`The primitive name ${repeated} is used more than once`);
  }
}

function guideTo(primitives: readonly Primitive[]): string {
  return [
    'Every brain has these primitives, each named by the `primitive` field:',
    ...primitives.map(
      ({ name, title, description, mediaType }) =>
        `- \`${name}\` (${title}), whose spec documents are ${mediaType}: ${description}`,
    ),
  ].join('\n');
}

export function knownPrimitives(primitives: readonly Primitive[]): KnownPrimitives {
  const names = primitives.map(({ name }) => name);
  requireSomePrimitive(names);
  requireDistinctNames(names);
  const byName = new Map(primitives.map((primitive) => [primitive.name, primitive]));
  const guide = guideTo(primitives);
  return {
    field: primitiveFieldOf(names),
    describe: (sentences) => `${sentences.join(' ')}\n\n${guide}`,
    primitiveNamed: (name) => {
      const primitive = byName.get(name);
      return primitive === undefined
        ? Effect.fail(new NotFound({ detail: `There is no primitive ${name}` }))
        : Effect.succeed(primitive);
    },
  };
}
