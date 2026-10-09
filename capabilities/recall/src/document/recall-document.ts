import type { CompiledSchema } from '@beonauto/definitions/document';
import type { ViewDetails } from '@beonauto/workflow-host';

export interface ValueContract {
  readonly schema?: CompiledSchema;
}

export interface FilterExpression {
  readonly source: string;
  readonly pointer: string;
  readonly line: number;
}

export interface RecallFunctionDefinitionDocument {
  readonly description?: string;
  readonly language: 'typescript';
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly answers: boolean;
  readonly filterExpressions: readonly FilterExpression[];
  readonly details: ViewDetails;
}
