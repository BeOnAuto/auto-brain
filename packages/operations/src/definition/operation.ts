import { Effect, Result } from 'effect';

import type { Kind, Scope } from '../caller/scope.ts';
import { done, refused } from '../outcome/outcome.ts';
import type { DeclarableReason, Refusal } from '../outcome/refusal.ts';
import { inputDecoder, outputEncoder, typeValidator } from './codecs.ts';
import { checkedDefinition } from './definition-checks.ts';
import type { Definition, InputSchemaFor, ObjectSchema, RelativePath } from './definition.ts';
import type { HandlerServices } from './handler-services.ts';
import { jsonSchemaDocumentOf } from './json-schema.ts';
import type { InputForm, RegistrationOf } from './registration.ts';

export interface Operation<S extends Scope, K extends Kind, Input, Output, R extends DeclarableReason, Services> {
  readonly registration: RegistrationOf<S, K>;
  readonly call: (input: Input) => Effect.Effect<Output, Refusal<R>, Services>;
}

export function defineQuery<
  const S extends Scope,
  const P extends RelativePath,
  In extends InputSchemaFor<S, P>,
  Out extends ObjectSchema,
  const R extends DeclarableReason = never,
  Services extends HandlerServices<S, 'query'> = never,
>(
  scope: S,
  definition: Definition<'query', P, In, Out, R, Services>,
): Operation<S, 'query', In['Type'], Out['Type'], R, Services> {
  return defineOperation(scope, 'query', definition);
}

export function defineCommand<
  const S extends Scope,
  const P extends RelativePath,
  In extends InputSchemaFor<S, P>,
  Out extends ObjectSchema,
  const R extends DeclarableReason = never,
  Services extends HandlerServices<S, 'command'> = never,
>(
  scope: S,
  definition: Definition<'command', P, In, Out, R, Services>,
): Operation<S, 'command', In['Type'], Out['Type'], R, Services> {
  return defineOperation(scope, 'command', definition);
}

function defineOperation<
  S extends Scope,
  K extends Kind,
  In extends ObjectSchema,
  Out extends ObjectSchema,
  R extends DeclarableReason,
  Services extends HandlerServices<S, K>,
>(
  scope: S,
  kind: K,
  definition: Definition<K, string, In, Out, R, Services>,
): Operation<S, K, In['Type'], Out['Type'], R, Services> {
  const { name, route, inputSchema, outputSchema, handle } = definition;
  const { pathParameters, addressesBrain } = checkedDefinition(scope, definition);
  const reasons: readonly DeclarableReason[] = [...new Set(definition.reasons)];
  const decodeInput = inputDecoder(inputSchema);
  const encodeOutput = outputEncoder(outputSchema);
  const validateInput = typeValidator(inputSchema);
  const validateOutput = typeValidator(outputSchema);
  return {
    registration: {
      scope,
      kind,
      name,
      title: definition.title,
      description: definition.description,
      route,
      pathParameters,
      addressesBrain,
      successStatus: definition.successStatus ?? 200,
      reasons,
      input: jsonSchemaDocumentOf(inputSchema),
      output: jsonSchemaDocumentOf(outputSchema),
      run: Effect.fnUntraced(function* (input: unknown, form: InputForm) {
        const handled = yield* Effect.result(handle(yield* decodeInput(input, form)));
        if (Result.isFailure(handled)) {
          const { _tag: reason, detail } = handled.failure;
          return yield* reasons.includes(reason) ? Effect.fail(refused(reason, detail)) : Effect.die(handled.failure);
        }
        return done(yield* encodeOutput(handled.success));
      }),
    },
    call: (input) => validateInput(input).pipe(Effect.flatMap(handle), Effect.tap(validateOutput)),
  };
}
