import type { Effect } from 'effect';

import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { Permission } from '../caller/permission.ts';
import type { Succeeded, Rejected } from '../outcome/outcome.ts';
import type { DeclarableReason } from '../outcome/rejection.ts';
import type { RegisteredPlainLanguage } from '../plain-language/plain-language.ts';
import type { SuccessStatusByKind } from './definition.ts';
import type { HandlerServices } from './handler-services.ts';
import type { JsonSchemaDocument } from './json-schema.ts';
import type { Route } from './route.ts';

export type InputEncoding = 'json' | 'strings';

export interface RegistrationOf<S extends OperationScope, K extends OperationKind> {
  readonly scope: S;
  readonly kind: K;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly route: Route<K>;
  readonly pathParameters: readonly string[];
  readonly targetsBrain: boolean;
  readonly successStatus: SuccessStatusByKind[K];
  readonly reachesOutside: boolean;
  readonly mayChangeOutside: boolean;
  readonly irreversible: boolean;
  readonly repeatable: boolean;
  readonly authorizesByToken: boolean;
  readonly permissions: readonly Permission[];
  readonly reasons: readonly DeclarableReason[];
  readonly input: JsonSchemaDocument;
  readonly output: JsonSchemaDocument;
  readonly plainLanguage?: RegisteredPlainLanguage;
  readonly run: (input: unknown, encoding: InputEncoding) => Effect.Effect<Succeeded, Rejected, HandlerServices<S, K>>;
}

export type Registration<S extends OperationScope = OperationScope> = {
  readonly [Each in S]: RegistrationOf<Each, 'query'> | RegistrationOf<Each, 'command'>;
}[S];
