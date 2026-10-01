import { Effect, Result, Schema, SchemaIssue, type SchemaAST, type StandardSchema } from 'effect';

import type { ObjectSchema } from './definition.ts';
import { refused, type Refused } from './outcome.ts';
import { pointerOf } from './pointer.ts';
import type { InputForm } from './registration.ts';

const strictly: SchemaAST.ParseOptions = { onExcessProperty: 'error', errors: 'all' };

const failureOf = SchemaIssue.makeFormatterStandardSchemaV1();

const asJsonObject = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json));

function invalidInput({ issues }: StandardSchema.StandardSchemaV1.FailureResult): Refused {
  return refused(
    'invalid_input',
    'The input does not match the input schema',
    issues.map(({ message, path }) => ({ detail: message, pointer: pointerOf(path) })),
  );
}

export function inputDecoder<In extends ObjectSchema>(
  schema: In,
): (input: unknown, form: InputForm) => Effect.Effect<In['Type'], Refused> {
  const decoders = {
    json: Schema.decodeUnknownEffect(Schema.toCodecJson(schema), strictly),
    strings: Schema.decodeUnknownEffect(Schema.toCodecStringTree(schema), strictly),
  };
  return Effect.fnUntraced(function* (input: unknown, form: InputForm) {
    const decoded = yield* Effect.result(decoders[form](input));
    if (Result.isFailure(decoded)) {
      return yield* Effect.fail(invalidInput(failureOf(decoded.failure.issue)));
    }
    return decoded.success;
  });
}

export function outputEncoder<Out extends ObjectSchema>(
  schema: Out,
): (output: Out['Type']) => Effect.Effect<Schema.JsonObject> {
  const encode = Schema.encodeUnknownEffect(Schema.toCodecJson(schema), strictly);
  return (output) => encode(output).pipe(Effect.flatMap(asJsonObject), Effect.orDie);
}

export function typeValidator<S extends ObjectSchema>(schema: S): (value: S['Type']) => Effect.Effect<S['Type']> {
  const validate = Schema.decodeUnknownEffect(Schema.toType(schema), strictly);
  return (value) => Effect.orDie(validate(value));
}
