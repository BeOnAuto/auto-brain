import type { CompiledSchema } from '@beonauto/specs/document';
import type { ParsedTemplate } from '@beonauto/specs/template';

import type { WrittenRoute } from '../route/compiled-route.ts';

export interface ValueContract {
  readonly schema?: CompiledSchema;
}

export interface InteractionFunctionDefinitionDocument {
  readonly description?: string;
  readonly to: ParsedTemplate;
  readonly expires: string;
  readonly expiresMs: number;
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly message: ParsedTemplate;
  readonly route?: WrittenRoute;
}
