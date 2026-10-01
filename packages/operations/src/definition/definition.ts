import type { Effect, Schema } from 'effect';

import type { Kind, Scope } from '../caller/scope.ts';
import type { DeclarableReason, Refusal } from '../outcome/refusal.ts';
import type { PathParameters, Route } from './route.ts';

interface ObjectValue {
  readonly [field: string]: unknown;
}

interface ReservedFieldsByScope {
  readonly org: { readonly org?: never };
  readonly brain: { readonly org?: never; readonly brain?: never };
}

export type RelativePath = `/${string}`;

export interface SuccessStatusByKind {
  readonly query: 200;
  readonly command: 200 | 201;
}

export type ObjectSchema<T extends ObjectValue = ObjectValue> = Schema.Constraint & {
  readonly Type: T;
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

export type InputSchemaFor<S extends Scope, P extends string> = ObjectSchema<
  ObjectValue & ReservedFieldsByScope[S] & { readonly [Parameter in PathParameters<P>]: string }
>;

export interface Definition<
  K extends Kind,
  P extends string,
  In extends ObjectSchema,
  Out extends ObjectSchema,
  R extends DeclarableReason,
  Services,
> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly route: Route<K, P>;
  readonly successStatus?: SuccessStatusByKind[K];
  readonly inputSchema: In;
  readonly outputSchema: Out;
  readonly reasons: readonly R[];
  readonly handle: (input: In['Type']) => Effect.Effect<Out['Type'], NoInfer<Refusal<R>>, Services>;
}
