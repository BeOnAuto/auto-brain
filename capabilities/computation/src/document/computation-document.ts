import type { CompiledSchema } from '@beonauto/definitions/document';

export interface ValueContract {
  readonly schema?: CompiledSchema;
}

export interface ComputationFunctionDefinitionDocument {
  readonly description?: string;
  readonly language: 'typescript';
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly program: string;
  readonly programLine: number;
}
