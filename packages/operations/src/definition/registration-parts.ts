import { Effect, Result } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import { rejected, type Rejected, type Succeeded } from '../outcome/outcome.ts';
import type { DeclarableReason, Rejection } from '../outcome/rejection.ts';
import { checkedDefinition } from './definition-checks.ts';
import type { Definition, ObjectSchema } from './definition.ts';
import { jsonSchemaDocumentOf } from './json-schema.ts';
import type { RegistrationOf } from './registration.ts';

export function settledOf<Answer, R extends DeclarableReason, Services>(
  handled: Effect.Effect<Answer, Rejection<R>, Services>,
  succeededWith: (answer: Answer) => Effect.Effect<Succeeded>,
  reasons: readonly DeclarableReason[],
): Effect.Effect<Succeeded, Rejected, Services> {
  return Effect.gen(function* () {
    const result = yield* Effect.result(handled);
    if (Result.isSuccess(result)) {
      return yield* succeededWith(result.success);
    }
    const rejection = result.failure;
    const { _tag: reason, detail } = rejection;
    const issues = 'issues' in rejection ? rejection.issues : undefined;
    const kind = 'kind' in rejection ? rejection.kind : undefined;
    const because = 'because' in rejection ? rejection.because : undefined;
    const described = rejected(reason, detail, issues, kind);
    return yield* reasons.includes(reason)
      ? Effect.fail(because === undefined ? described : { ...described, because })
      : Effect.die(rejection);
  });
}

type RegisteredDefinition<K extends OperationKind> = Pick<
  Definition<K, string, ObjectSchema, ObjectSchema, DeclarableReason, unknown>,
  | 'name'
  | 'title'
  | 'description'
  | 'route'
  | 'successStatus'
  | 'reachesOutside'
  | 'mayChangeOutside'
  | 'irreversible'
  | 'repeatable'
  | 'permittedBy'
  | 'inputSchema'
  | 'outputSchema'
  | 'reasons'
>;

type RegisteredFields<S extends OperationScope, K extends OperationKind> = Omit<
  RegistrationOf<S, K>,
  'run' | 'plainLanguage' | 'servedOverHttpAlone'
>;

export function registeredFieldsOf<S extends OperationScope, K extends OperationKind>(
  scope: S,
  kind: K,
  definition: RegisteredDefinition<K>,
): RegisteredFields<S, K> {
  const { pathParameters, targetsBrain, permissions } = checkedDefinition(scope, kind, definition);
  return {
    scope,
    kind,
    name: definition.name,
    title: definition.title,
    description: definition.description,
    route: definition.route,
    pathParameters,
    targetsBrain,
    successStatus: definition.successStatus ?? 200,
    reachesOutside: definition.reachesOutside ?? false,
    mayChangeOutside: definition.mayChangeOutside ?? false,
    irreversible: definition.irreversible ?? false,
    repeatable: definition.repeatable ?? false,
    permissions,
    reasons: [...new Set(definition.reasons)],
    input: jsonSchemaDocumentOf(definition.inputSchema),
  };
}
