import { Buffer } from 'node:buffer';

import { Result, type Schema } from 'effect';

import { interactionBounds } from '../run/run-bounds.ts';
import { renderedText, type TextFailure } from '../run/text-rendering.ts';
import type { McpChannel } from './channel-settings.ts';

export interface RequestFields {
  readonly to: string;
  readonly message: string;
  readonly run_id: string;
  readonly function: string;
  readonly expires_at: string;
  readonly answer_schema: Schema.Json;
}

export const requestFieldNames: readonly (keyof RequestFields)[] = [
  'to',
  'message',
  'run_id',
  'function',
  'expires_at',
  'answer_schema',
];

export type ArgumentsFailure =
  | { readonly reason: 'argument'; readonly argument: string; readonly failure: TextFailure }
  | { readonly reason: 'too_large'; readonly bytes: number };

export interface RenderedArguments {
  readonly input: Readonly<Record<string, string>>;
  readonly bytes: number;
}

function variablesOf(fields: RequestFields): Readonly<Record<string, Schema.Json>> {
  return { ...fields };
}

export function renderedArguments(
  channel: Pick<McpChannel, 'with'>,
  fields: RequestFields,
): Result.Result<RenderedArguments, ArgumentsFailure> {
  const input: Record<string, string> = {};
  for (const [argument, template] of channel.with) {
    const rendered = renderedText(template, variablesOf(fields), interactionBounds.argumentBytes + 1);
    if (Result.isFailure(rendered)) {
      return Result.fail({ reason: 'argument', argument, failure: rendered.failure });
    }
    input[argument] = rendered.success;
  }
  const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
  return bytes > interactionBounds.argumentBytes
    ? Result.fail({ reason: 'too_large', bytes })
    : Result.succeed({ input, bytes });
}
