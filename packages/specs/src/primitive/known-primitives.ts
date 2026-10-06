import { NotFound, type JsonSchemaDocument, type Registration } from '@beonauto/operations';
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
  readonly describe: (sentences: readonly string[]) => string;
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

function guideTo(primitives: readonly Primitive[]): string {
  return [
    'This brain supports these definition types, selected by the legacy `primitive` field:',
    ...primitives.map(
      ({ name, title, description, mediaType }) =>
        `- \`${name}\` (${title}), whose definition documents are ${mediaType}: ${description}`,
    ),
  ].join('\n');
}

const primitiveMeaning = 'The API type identifier of the function or workflow definition';

function withPrimitiveField(
  { schema, definitions }: JsonSchemaDocument,
  names: readonly string[],
  meaning: string,
): JsonSchemaDocument {
  const primitive = { type: 'string', enum: [...names], description: `${meaning}: ${names.join(', ')}` };
  return { schema: { ...schema, properties: Object.assign({}, schema['properties'], { primitive }) }, definitions };
}

export function knownPrimitives(primitives: readonly Primitive[]): KnownPrimitives {
  const names = primitives.map(({ name }) => name);
  requireSomePrimitive(names);
  requireDistinctNames(names);
  const byName = new Map(primitives.map((primitive) => [primitive.name, primitive]));
  const guide = guideTo(primitives);
  return {
    field: PrimitiveField,
    describe: (sentences) => `${sentences.join(' ')}\n\n${guide}`,
    publish: (operation, meaning = primitiveMeaning) => ({
      ...operation,
      registration: {
        ...operation.registration,
        input: withPrimitiveField(operation.registration.input, names, meaning),
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
