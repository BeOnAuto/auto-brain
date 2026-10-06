import { Buffer } from 'node:buffer';

import { Schema, SchemaTransformation } from 'effect';

import { jsonBytesOf, mostInputBytes } from '../execution/recorded-size.ts';

const mostSourceBytes = 65_536;

function fitsInSourceLimit(source: string): boolean {
  return Buffer.byteLength(source, 'utf8') <= mostSourceBytes;
}

export const SpecNameField = Schema.String.annotate({
  description: 'The definition name: 3 to 48 lowercase letters, digits and hyphens, starting with a letter',
}).check(Schema.isPattern(/^[a-z][a-z0-9-]{2,47}$/u));

export const SourceField = Schema.String.annotate({
  description: `The definition document in its type's format, at most ${mostSourceBytes} bytes in UTF-8`,
}).check(
  Schema.makeFilter(fitsInSourceLimit, {
    expected: `a document of at most ${mostSourceBytes} bytes in UTF-8`,
    toJsonSchema: () => [{ maxLength: mostSourceBytes }, true],
  }),
);

export const ExecutionIdField = Schema.String.annotate({
  description: 'The run id, a UUID in any case, kept in lowercase',
})
  .check(Schema.isUUID())
  .pipe(Schema.decodeTo(Schema.String, SchemaTransformation.toLowerCase()));

function fitsInInputLimit(input: Schema.Json): boolean {
  return jsonBytesOf(input) <= mostInputBytes;
}

export const InputField = Schema.Json.annotate({
  description: `The run input: any JSON value the definition takes, {} when left out, at most ${mostInputBytes} bytes as JSON in UTF-8`,
}).check(
  Schema.makeFilter(fitsInInputLimit, { expected: `an input of at most ${mostInputBytes} bytes as JSON in UTF-8` }),
);

export const IncludeRetiredField = Schema.Boolean.annotate({
  description: 'Whether to list retired definitions as well; false when left out',
});
