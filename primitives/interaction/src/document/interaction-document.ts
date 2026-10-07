import type { CompiledSchema } from '@beonauto/specs/document';
import type { ParsedTemplate } from '@beonauto/specs/template';

export interface ValueContract {
  readonly schema?: CompiledSchema;
}

export interface InteractionFunctionDefinitionDocument {
  readonly description?: string;
  readonly channel: string;
  readonly to: ParsedTemplate;
  readonly expires: string;
  readonly expiresMs: number;
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly message: ParsedTemplate;
}
