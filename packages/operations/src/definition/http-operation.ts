import { Effect } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { DeclarableReason } from '../outcome/rejection.ts';
import { inputDecoder, outputEncoder } from './codecs.ts';
import type { HttpBodyOf, HttpDefinition, InputSchemaFor, ObjectSchema, RelativePath } from './definition.ts';
import type { HandlerServices } from './handler-services.ts';
import { answeredWith, bodyArgumentsOf, requireMostBytes } from './http-body.ts';
import { registeredFieldsOf, settledOf } from './registration-parts.ts';
import type { RegistrationOf } from './registration.ts';

export interface HttpOperation<S extends OperationScope, K extends OperationKind> {
  readonly registration: RegistrationOf<S, K>;
}

export function defineHttpOperation<
  const S extends OperationScope,
  const K extends OperationKind,
  const P extends RelativePath,
  const B extends HttpBodyOf<K>,
  In extends InputSchemaFor<S, P>,
  Out extends ObjectSchema,
  const R extends DeclarableReason = never,
  Services extends HandlerServices<S, K> = never,
>(scope: S, kind: K, definition: HttpDefinition<K, P, B, In, Out, R, Services>): HttpOperation<S, K> {
  const { name, body, inputSchema, outputSchema, handle } = definition;
  const fields = registeredFieldsOf(scope, kind, definition);
  requireMostBytes(name, body);
  const decodeInput = inputDecoder(inputSchema);
  const answered = answeredWith(outputEncoder(outputSchema));
  const run: RegistrationOf<S, K>['run'] = (input, encoding, given) =>
    Effect.flatMap(decodeInput(input, encoding), (decoded) =>
      Effect.flatMap(bodyArgumentsOf[body.kind](name, given), (bodyArguments) =>
        settledOf(handle(decoded, ...bodyArguments), answered, fields.reasons),
      ),
    );
  return { registration: { ...fields, servedOverHttpAlone: body, run } };
}
