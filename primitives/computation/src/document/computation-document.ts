import type { CompiledSchema } from '@beonauto/specs/document';

export interface ValueContract {
  readonly schema?: CompiledSchema;
}

export interface ComputationFunctionDefinitionDocument {
  readonly description?: string;
  readonly language: 'jq';
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly program: string;
  readonly programLine: number;
}
