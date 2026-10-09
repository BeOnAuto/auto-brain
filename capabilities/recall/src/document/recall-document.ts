import type { CompiledSchema } from '@beonauto/definitions/document';
import type { ViewDetails } from '@beonauto/workflow-host';

export interface ValueContract {
  readonly schema?: CompiledSchema;
}

export interface RecallAnswer {
  readonly source: string;
  readonly line: number;
}

export interface RecallFunctionDefinitionDocument {
  readonly description?: string;
  readonly language: 'jq';
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly answer?: RecallAnswer;
  readonly details: ViewDetails;
}
