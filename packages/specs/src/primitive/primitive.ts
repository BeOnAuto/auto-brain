import type { InvalidInput, Unavailable } from '@beonauto/operations';
import { Effect, type Schema } from 'effect';

export interface SpecSummary {
  readonly description?: string;
  readonly inputSchema?: Schema.JsonObject;
  readonly outputSchema?: Schema.JsonObject;
}

export interface ExecutionContext {
  readonly id: string;
  readonly org: string;
  readonly brain: string;
  readonly spec: { readonly name: string; readonly version: number };
}

export interface Finished {
  readonly output: Schema.Json;
  readonly record: Schema.JsonObject;
}

export interface FinishesLater {
  readonly finishesLater: true;
  readonly record: Schema.JsonObject;
}

export type Executed = Finished | FinishesLater;

export interface PrimitiveDefinition<Parsed> {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mediaType: string;
  readonly parse: (source: string) => Effect.Effect<Parsed, InvalidInput>;
  readonly summarize: (parsed: NoInfer<Parsed>) => SpecSummary;
  readonly execute: (
    parsed: NoInfer<Parsed>,
    input: Schema.Json,
    execution: ExecutionContext,
  ) => Effect.Effect<Executed, InvalidInput | Unavailable>;
}

export interface PreparedSpec {
  readonly summary: SpecSummary;
  readonly execute: (
    input: Schema.Json,
    execution: ExecutionContext,
  ) => Effect.Effect<Executed, InvalidInput | Unavailable>;
}

export interface Primitive {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mediaType: string;
  readonly prepare: (source: string) => Effect.Effect<PreparedSpec, InvalidInput>;
}

const primitiveName = /^[a-z][a-z0-9-]{2,31}$/u;

export function isPrimitiveName(name: string): boolean {
  return primitiveName.test(name);
}

export function definePrimitive<Parsed>(definition: PrimitiveDefinition<Parsed>): Primitive {
  const { name, title, description, mediaType, parse, summarize, execute } = definition;
  if (!isPrimitiveName(name)) {
    throw new Error(`The primitive name ${name} is malformed`);
  }
  return {
    name,
    title,
    description,
    mediaType,
    prepare: (source) =>
      parse(source).pipe(
        Effect.map((parsed) => ({
          summary: summarize(parsed),
          execute: (input, execution) => execute(parsed, input, execution),
        })),
      ),
  };
}
