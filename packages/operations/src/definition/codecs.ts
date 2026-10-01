import { Cause, Effect, Result, Schema, SchemaIssue, type SchemaAST, type StandardSchema } from 'effect';

import { rejected, type Rejected } from '../outcome/outcome.ts';
import { pointerOf } from '../outcome/pointer.ts';
import type { ObjectSchema } from './definition.ts';
import type { InputEncoding } from './registration.ts';

type IssueSegment = PropertyKey | StandardSchema.StandardSchemaV1.PathSegment;

const strictly: SchemaAST.ParseOptions = { onExcessProperty: 'error', errors: 'all' };

const failureOf = SchemaIssue.makeFormatterStandardSchemaV1();

const asJsonObject = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json));

function isPropertyKey(segment: IssueSegment): segment is PropertyKey {
  return typeof segment !== 'object';
}

function invalidInput({ issues }: StandardSchema.StandardSchemaV1.FailureResult): Rejected {
  return rejected(
    'invalid_input',
    'The input does not match the input schema',
    issues.map(({ message, path = [] }) => ({
      detail: message,
      pointer: pointerOf(path.filter((segment) => isPropertyKey(segment))),
    })),
  );
}

function nestedTooDeeply(): Rejected {
  return rejected('invalid_input', 'The input is nested too deeply', [
    { detail: 'The input is nested too deeply', pointer: '' },
  ]);
}

function overflowedTheStack<E>(cause: Cause.Cause<E>): boolean {
  return Cause.squash(cause) instanceof RangeError;
}

export function inputDecoder<In extends ObjectSchema>(
  schema: In,
): (input: unknown, encoding: InputEncoding) => Effect.Effect<In['Type'], Rejected> {
  const decoders = {
    json: Schema.decodeUnknownEffect(Schema.toCodecJson(schema), strictly),
    strings: Schema.decodeUnknownEffect(Schema.toCodecStringTree(schema), strictly),
  };
  const decode = Effect.fnUntraced(function* (input: unknown, encoding: InputEncoding) {
    const decoded = yield* Effect.result(decoders[encoding](input));
    if (Result.isFailure(decoded)) {
      return yield* Effect.fail(invalidInput(failureOf(decoded.failure.issue)));
    }
    return decoded.success;
  });
  return (input, encoding) =>
    Effect.catchCauseIf(decode(input, encoding), overflowedTheStack, () => Effect.fail(nestedTooDeeply()));
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
