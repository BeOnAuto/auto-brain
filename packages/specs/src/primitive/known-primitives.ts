import { NotFound, alternatives, type JsonSchemaDocument, type Registration } from '@beonauto/operations';
import { Effect, Schema } from 'effect';

import { isPrimitiveName, type Primitive } from './primitive.ts';

interface PublishedOperation {
  readonly registration: Registration<'brain'>;
}

export const PrimitiveField = Schema.String.check(
  Schema.makeFilter(isPrimitiveName, {
    expected: 'a primitive name: 3 to 32 lowercase letters, digits and hyphens, starting with a letter',
  }),
);

export interface KnownPrimitives {
  readonly field: typeof PrimitiveField;
  readonly typesWithGuides: string;
  readonly publish: <Operation extends PublishedOperation>(operation: Operation, meaning?: string) => Operation;
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

function articled(noun: string): string {
  return /^[aeiou]/u.test(noun) ? `an ${noun}` : `a ${noun}`;
}

const primitiveMeaning = "The definition's type";

function withPrimitiveField(
  { schema, definitions }: JsonSchemaDocument,
  primitives: readonly Primitive[],
  meaning: string,
): JsonSchemaDocument {
  const types = alternatives(primitives.map(({ name, noun }) => `${name} for ${articled(noun.one)}`));
  const primitive = {
    type: 'string',
    enum: primitives.map(({ name }) => name),
    description: `${meaning}: ${types}`,
  };
  return { schema: { ...schema, properties: Object.assign({}, schema['properties'], { primitive }) }, definitions };
}

export function knownPrimitives(primitives: readonly Primitive[]): KnownPrimitives {
  const names = primitives.map(({ name }) => name);
  requireSomePrimitive(names);
  requireDistinctNames(names);
  const byName = new Map(primitives.map((primitive) => [primitive.name, primitive]));
  return {
    field: PrimitiveField,
    typesWithGuides: primitives
      .map(({ name, noun, guide }) => `${name}, ${articled(noun.one)}, guide ${guide.name}`)
      .join('; '),
    publish: (operation, meaning = primitiveMeaning) => ({
      ...operation,
      registration: {
        ...operation.registration,
        input: withPrimitiveField(operation.registration.input, primitives, meaning),
      },
    }),
    primitiveNamed: (name) => {
      const primitive = byName.get(name);
      return primitive === undefined
        ? Effect.fail(new NotFound({ detail: `There is no primitive ${name}` }))
        : Effect.succeed(primitive);
    },
  };
}
