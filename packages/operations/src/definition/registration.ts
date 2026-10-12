import type { OperationKind, OperationScope } from '../caller/operation-scope.ts';
import type { Permission } from '../caller/permission.ts';
import type { Answered, Succeeded } from '../outcome/outcome.ts';
import type { DeclarableReason } from '../outcome/rejection.ts';
import type { RegisteredPlainLanguage } from '../plain-language/plain-language.ts';
import type { HttpBody, SuccessStatusByKind } from './definition.ts';
import type { HandlerServices } from './handler-services.ts';
import type { JsonSchemaDocument } from './json-schema.ts';
import type { RegisteredRun } from './registered-run.ts';
import type { Route } from './route.ts';

export interface RegisteredFieldsOf<S extends OperationScope, K extends OperationKind> {
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
  readonly permissions: readonly Permission[];
  readonly reasons: readonly DeclarableReason[];
  readonly input: JsonSchemaDocument;
  readonly plainLanguage?: RegisteredPlainLanguage;
}

interface RunnableOf<S extends OperationScope, K extends OperationKind, A extends Succeeded> extends RegisteredFieldsOf<
  S,
  K
> {
  readonly servedOverHttpAlone?: HttpBody;
  readonly run: RegisteredRun<HandlerServices<S, K>, A>;
}

export interface RegistrationOf<S extends OperationScope, K extends OperationKind> extends RunnableOf<S, K, Answered> {
  readonly servedOverHttpAlone?: never;
}

export interface HttpRegistrationOf<S extends OperationScope, K extends OperationKind> extends RunnableOf<
  S,
  K,
  Succeeded
> {
  readonly servedOverHttpAlone: HttpBody;
}

export type Runnable<S extends OperationScope = OperationScope, A extends Succeeded = Succeeded> = {
  readonly [Each in S]: RunnableOf<Each, 'query', A> | RunnableOf<Each, 'command', A>;
}[S];

export type Registration<S extends OperationScope = OperationScope> = {
  readonly [Each in S]: RegistrationOf<Each, 'query'> | RegistrationOf<Each, 'command'>;
}[S];

export type HttpRegistration<S extends OperationScope = OperationScope> = {
  readonly [Each in S]: HttpRegistrationOf<Each, 'query'> | HttpRegistrationOf<Each, 'command'>;
}[S];

export type RouteRegistration<S extends OperationScope = OperationScope> = Registration<S> | HttpRegistration<S>;
