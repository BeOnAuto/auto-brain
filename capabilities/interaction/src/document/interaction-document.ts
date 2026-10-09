import type { CompiledSchema } from '@beonauto/definitions/document';
import type { ParsedTemplate } from '@beonauto/definitions/template';

import type { ReplyRule } from '../replies/reply-rule.ts';
import type { WrittenRoute } from '../route/compiled-route.ts';

export interface ValueContract {
  readonly schema?: CompiledSchema;
}

export interface InteractionFunctionDefinitionDocument {
  readonly description?: string;
  readonly to: ParsedTemplate;
  readonly from?: ParsedTemplate;
  readonly expires: string;
  readonly expiresMs: number;
  readonly input: ValueContract;
  readonly output: ValueContract;
  readonly message: ParsedTemplate;
  readonly route?: WrittenRoute;
  readonly reply?: ReplyRule;
}
