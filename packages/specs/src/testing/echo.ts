import { InvalidInput } from '@beonauto/operations';
import { Effect, Predicate, Result, Schema, SchemaIssue } from 'effect';

import { definePrimitive } from '../index.ts';

const decodeDocument = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ greeting: Schema.String, description: Schema.optionalKey(Schema.String) })),
  { onExcessProperty: 'error', errors: 'all' },
);

const formatted = SchemaIssue.makeFormatterDefault();

const parseDocument = Effect.fnUntraced(function* (source: string) {
  const decoded = yield* Effect.result(decodeDocument(source));
  if (Result.isFailure(decoded)) {
    return yield* new InvalidInput({
      detail: 'The echo document is not a JSON object with a string greeting',
      issues: [{ detail: formatted(decoded.failure.issue), pointer: '' }],
    });
  }
  return decoded.success;
});

const notAnObject = new InvalidInput({
  detail: 'The input of an echo spec must be a JSON object',
  issues: [{ detail: 'Expected a JSON object', pointer: '' }],
});

export const echo = definePrimitive({
  name: 'echo',
  title: 'Echo',
  description: [
    'Answers every execution with the greeting its spec declares and the input it was given.',
    'A spec document of echo is a JSON object with a string `greeting` and an optional string `description`,',
    'for example {"greeting": "Hello", "description": "Greets the caller"}.',
    'The input of an execution must be a JSON object.',
  ].join(' '),
  mediaType: 'application/json',
  parse: parseDocument,
  summarize: ({ greeting, description }) => ({
    ...(description === undefined ? {} : { description }),
    inputSchema: { type: 'object' },
    outputSchema: {
      type: 'object',
      properties: { greeting: { const: greeting }, input: { type: 'object' } },
      required: ['greeting', 'input'],
    },
  }),
  execute: ({ greeting }, input) =>
    Predicate.isObject(input) && !Array.isArray(input)
      ? Effect.succeed({ output: { greeting, input }, record: { greeting } })
      : Effect.fail(notAnObject),
});
