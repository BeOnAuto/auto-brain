import { Effect, Result } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import { succeeded, rejected } from '../outcome/outcome.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import { inputDecoder, outputEncoder, typeValidator } from './codecs.ts';
import { checkedDefinition } from './definition-checks.ts';
import type { Definition, InputSchemaFor, ObjectSchema, RelativePath } from './definition.ts';
import type { HandlerServices } from './handler-services.ts';
import { jsonSchemaDocumentOf } from './json-schema.ts';
import type { InputEncoding, RegistrationOf } from './registration.ts';

export interface Operation<
  S extends OperationScope,
  K extends OperationKind,
  Input,
  Output,
  R extends DeclarableReason,
  Services,
> {
  readonly registration: RegistrationOf<S, K>;
  readonly call: (input: Input) => Effect.Effect<Output, Rejection<R>, Services>;
}

export function defineQuery<
  const S extends OperationScope,
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
  const S extends OperationScope,
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
  S extends OperationScope,
  K extends OperationKind,
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
  const { pathParameters, targetsBrain } = checkedDefinition(scope, definition);
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
      targetsBrain,
      successStatus: definition.successStatus ?? 200,
      reasons,
      input: jsonSchemaDocumentOf(inputSchema),
      output: jsonSchemaDocumentOf(outputSchema),
      run: Effect.fnUntraced(function* (input: unknown, encoding: InputEncoding) {
        const handled = yield* Effect.result(handle(yield* decodeInput(input, encoding)));
        if (Result.isFailure(handled)) {
          const rejection = handled.failure;
          const { _tag: reason, detail } = rejection;
          const issues = 'issues' in rejection ? rejection.issues : undefined;
          return yield* reasons.includes(reason)
            ? Effect.fail(rejected(reason, detail, issues))
            : Effect.die(rejection);
        }
        return succeeded(yield* encodeOutput(handled.success));
      }),
    },
    call: (input) => validateInput(input).pipe(Effect.flatMap(handle), Effect.tap(validateOutput)),
  };
}
