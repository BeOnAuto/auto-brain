import type { Effect } from 'effect';

import type { Kind, Scope } from '../caller/scope.ts';
import type { Done, Refused } from '../outcome/outcome.ts';
import type { DeclarableReason } from '../outcome/refusal.ts';
import type { SuccessStatusByKind } from './definition.ts';
import type { HandlerServices } from './handler-services.ts';
import type { JsonSchemaDocument } from './json-schema.ts';
import type { Route } from './route.ts';

export type InputForm = 'json' | 'strings';

export interface RegistrationOf<S extends Scope, K extends Kind> {
  readonly scope: S;
  readonly kind: K;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly route: Route<K>;
  readonly pathParameters: readonly string[];
  readonly addressesBrain: boolean;
  readonly successStatus: SuccessStatusByKind[K];
  readonly reasons: readonly DeclarableReason[];
  readonly input: JsonSchemaDocument;
  readonly output: JsonSchemaDocument;
  readonly run: (input: unknown, form: InputForm) => Effect.Effect<Done, Refused, HandlerServices<S, K>>;
}

export type Registration<S extends Scope = Scope> = {
  readonly [Each in S]: RegistrationOf<Each, 'query'> | RegistrationOf<Each, 'command'>;
}[S];
