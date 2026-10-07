import { BrainIdSchema, rejected, type Rejected } from '@beonauto/operations';
import { Option, Result, Schema, SchemaIssue } from 'effect';

import { inlinedRootOf, withoutUnreferencedDefinitions, type JsonSchema } from './tool-schema.ts';

export interface BrainArgument {
  readonly brain: string;
  readonly input: Readonly<Record<string, unknown>>;
}

const brainProperty: JsonSchema = {
  ...Schema.toJsonSchemaDocument(BrainIdSchema).schema,
  description: 'The id of the brain to act in',
};

const ObjectFieldsSchema = Schema.Struct({
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
});

const UnionSchema = Schema.Struct({
  anyOf: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  $defs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
});

const objectFieldsOf = Schema.decodeUnknownSync(ObjectFieldsSchema);

const unionOf = Schema.decodeUnknownOption(UnionSchema);

const decodeBrainArgument = Schema.decodeUnknownResult(Schema.Struct({ brain: BrainIdSchema }));

const failureOf = SchemaIssue.makeFormatterStandardSchemaV1();

function withBrainProperty(object: Readonly<JsonSchema>): JsonSchema {
  const { properties = {}, required = [] } = objectFieldsOf(object);
  return { ...object, properties: { brain: brainProperty, ...properties }, required: ['brain', ...required] };
}

function withBrainOnEveryMember(schema: Readonly<JsonSchema>): JsonSchema {
  return Option.match(unionOf(schema), {
    onNone: () => withBrainProperty(schema),
    onSome: ({ anyOf, $defs = {} }) => ({
      ...schema,
      anyOf: anyOf.map((member) => withBrainProperty(inlinedRootOf({ schema: member, definitions: $defs }))),
    }),
  });
}

export function withBrainArgument(schema: Readonly<JsonSchema>): JsonSchema {
  return withoutUnreferencedDefinitions(withBrainOnEveryMember(schema));
}

export function withoutBrain(input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(input).filter(([key]: readonly [string, unknown]) => key !== 'brain'));
}

export function brainArgumentOf(input: Readonly<Record<string, unknown>>): Result.Result<BrainArgument, Rejected> {
  const decoded = decodeBrainArgument(input);
  if (Result.isSuccess(decoded)) {
    return Result.succeed({ brain: decoded.success.brain, input: withoutBrain(input) });
  }
  const issues = failureOf(decoded.failure.issue).issues.map(({ message }) => ({ detail: message, pointer: '/brain' }));
  return Result.fail(rejected('invalid_input', 'The input does not match the input schema', issues));
}
