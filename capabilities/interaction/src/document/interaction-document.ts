import type { CompiledSchema } from '@beonauto/definitions/document';
import type { ParsedTemplate } from '@beonauto/definitions/template';

import type { ReplyRule } from '../replies/reply-rule.ts';
import type { WrittenRoute } from '../tool-blocks/compiled-tool-block.ts';
import type { CallBlock } from '../tool-blocks/tool-block-schemas.ts';

export interface ValueContract {
  readonly schema?: CompiledSchema;
}

interface WrittenFunction {
  readonly description?: string;
  readonly input: ValueContract;
}

export interface CallDocument extends WrittenFunction {
  readonly shape: 'call';
  readonly call: CallBlock;
  readonly output: { readonly schema: CompiledSchema };
}

export interface RequestDocument extends WrittenFunction {
  readonly shape: 'request';
  readonly output: ValueContract;
  readonly to: ParsedTemplate;
  readonly from?: ParsedTemplate;
  readonly expires: string;
  readonly expiresMs: number;
  readonly message: ParsedTemplate;
  readonly route?: WrittenRoute;
  readonly reply?: ReplyRule;
}

export type InteractionFunctionDefinitionDocument = CallDocument | RequestDocument;
