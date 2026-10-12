import {
  strictRecordedDecoder,
  type KeptContent,
  type PresentedFact,
  type Presenter,
  type Recorded,
  type RecordedFact,
} from '@beonauto/operations';
import { Schema } from 'effect';

import { runDecidersOf, type RunDeciders } from '../runs/run-decider.ts';
import { isCoreRunFactType } from '../runs/run-events.ts';

export interface DeclaredFact {
  readonly type: string;
  readonly schema: Schema.Top;
  readonly present: (recorded: RecordedFact, content: KeptContent) => PresentedFact;
}

export interface CapabilityFacts {
  readonly onRuns: readonly DeclaredFact[];
  readonly streams: readonly Presenter[];
}

export const noFacts: CapabilityFacts = { onRuns: [], streams: [] };

export function declaredFact<Fact extends Recorded>(
  type: Fact['type'],
  schema: Schema.Top & Schema.ConstraintCodec<Fact, unknown>,
  present: (fact: Fact, content: KeptContent) => PresentedFact,
): DeclaredFact {
  const decode = strictRecordedDecoder(schema);
  return { type, schema, present: (recorded, content) => present(decode(recorded), content) };
}

export interface RunFacts extends RunDeciders {
  readonly declared: readonly DeclaredFact[];
}

function requireOwnTypes(declared: readonly DeclaredFact[]): void {
  const types = declared.map(({ type }) => type);
  const taken = types.find((type, index) => isCoreRunFactType(type) || types.indexOf(type) !== index);
  if (taken !== undefined) {
    throw new Error(`The fact ${taken} is declared more than once or is one the brain records itself`);
  }
}

export function runFactsOf(declared: readonly DeclaredFact[]): RunFacts {
  const types = new Set(declared.map(({ type }) => type));
  const isDeclared = Schema.is(Schema.Union(declared.map(({ schema }) => schema)));
  return { declared, ...runDecidersOf(isDeclared, ({ type }) => types.has(type)) };
}

export function declaredFactsOf(capabilities: readonly { readonly facts: CapabilityFacts }[]): readonly DeclaredFact[] {
  const declared = capabilities.flatMap(({ facts }) => facts.onRuns);
  requireOwnTypes(declared);
  return declared;
}

export function ownedStreamsOf(capabilities: readonly { readonly facts: CapabilityFacts }[]): readonly Presenter[] {
  return capabilities.flatMap(({ facts }) => facts.streams);
}
