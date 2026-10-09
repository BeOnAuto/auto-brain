import type { CompiledSchema } from '@beonauto/definitions/document';
import type { ViewDetails } from '@beonauto/workflow-host';

export interface ValueContract {
  readonly schema?: CompiledSchema;
}

export interface RecallFunctionDefinitionDocument {
  readonly description?: string;
  readonly language: 'typescript';
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly answers: boolean;
  readonly details: ViewDetails;
}
