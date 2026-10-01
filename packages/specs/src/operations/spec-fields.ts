import { Buffer } from 'node:buffer';

import { Schema, SchemaTransformation } from 'effect';

import { jsonBytesOf, mostInputBytes } from '../execution/recorded-size.ts';

const mostSourceBytes = 65_536;

function fitsInSourceLimit(source: string): boolean {
  return Buffer.byteLength(source, 'utf8') <= mostSourceBytes;
}

export const SpecNameField = Schema.String.annotate({
  description: 'The name of the spec: 3 to 48 lowercase letters, digits and hyphens, starting with a letter',
}).check(Schema.isPattern(/^[a-z][a-z0-9-]{2,47}$/u));

export const SourceField = Schema.String.annotate({
  description: `The spec document, written as its primitive describes, at most ${mostSourceBytes} bytes in UTF-8`,
}).check(
  Schema.makeFilter(fitsInSourceLimit, {
    expected: `a document of at most ${mostSourceBytes} bytes in UTF-8`,
    toJsonSchema: () => [{ maxLength: mostSourceBytes }, true],
  }),
);

export const ExecutionIdField = Schema.String.annotate({
  description: 'The id of the execution, a UUID in any case, kept in lowercase',
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

function fitsInInputLimit(input: Schema.Json): boolean {
  return jsonBytesOf(input) <= mostInputBytes;
}

export const InputField = Schema.Json.annotate({
  description: `The input of the execution: any JSON value the spec takes, {} when left out, at most ${mostInputBytes} bytes as JSON in UTF-8`,
}).check(
  Schema.makeFilter(fitsInInputLimit, { expected: `an input of at most ${mostInputBytes} bytes as JSON in UTF-8` }),
);

export const IncludeRetiredField = Schema.Boolean.annotate({
  description: 'Whether to list retired specs as well; false when left out',
});
