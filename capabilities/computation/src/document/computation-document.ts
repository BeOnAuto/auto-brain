import type { OutputShape } from '@on.auto/definitions';
import type { CompiledSchema } from '@on.auto/json-schema';

export interface ValueContract {
  readonly schema?: CompiledSchema;
}

export interface OutputContract extends ValueContract {
  readonly shape?: OutputShape;
}

export interface ComputationFunctionDefinitionDocument {
  readonly description?: string;
  readonly language: 'typescript';
  readonly input: ValueContract;
  readonly output: OutputContract;
  readonly program: string;
  readonly programLine: number;
}
