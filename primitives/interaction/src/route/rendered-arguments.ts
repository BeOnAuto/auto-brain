import { Buffer } from 'node:buffer';

import { toolBounds } from '@beonauto/mcp';
import { parsedTemplate } from '@beonauto/specs/template';
import { Result, type Schema } from 'effect';

import { interactionEngine } from '../document/request-templates.ts';
import type { RequestRecord } from '../run/request-record.ts';
import { renderedText, type TextFailure } from '../run/text-rendering.ts';
import { isLoneExpression, renderedValue } from '../run/value-rendering.ts';
import { childrenOf, isJsonArray, isJsonParent, type JsonChild } from './json-children.ts';

export type Templates = Readonly<Record<string, Schema.Json>>;

export type TemplateVariables = Readonly<Record<string, Schema.Json>>;

export type ArgumentsFailure =
  | { readonly reason: 'argument'; readonly argument: string; readonly failure: TextFailure }
  | { readonly reason: 'too_large'; readonly bytes: number };

export interface RenderedArguments {
  readonly input: Readonly<Record<string, Schema.Json>>;
  readonly bytes: number;
}

const mostBytes = toolBounds.argumentBytes + 1;

function renderedString(text: string, variables: TemplateVariables): Result.Result<Schema.Json, TextFailure> {
  const parsed = parsedTemplate(interactionEngine, text, 1);
  if (Result.isFailure(parsed)) {
    return Result.fail({ reason: 'failed', detail: parsed.failure.map(({ detail }) => detail).join('; '), line: 1 });
  }
  return isLoneExpression(text)
    ? renderedValue(parsed.success, variables, mostBytes)
    : renderedText(parsed.success, variables, mostBytes);
}

function pathOf(path: string, key: string): string {
  return path === '' ? key : `${path}/${key}`;
}

function renderedEntries(
  entries: readonly JsonChild[],
  variables: TemplateVariables,
  path: string,
): Result.Result<readonly JsonChild[], ArgumentsFailure> {
  const rendered: JsonChild[] = [];
  for (const [key, value] of entries) {
    const each = renderedJson(value, variables, pathOf(path, key));
    if (Result.isFailure(each)) {
      return Result.fail(each.failure);
    }
    rendered.push([key, each.success]);
  }
  return Result.succeed(rendered);
}

function renderedJson(
  value: Schema.Json,
  variables: TemplateVariables,
  path: string,
): Result.Result<Schema.Json, ArgumentsFailure> {
  if (typeof value === 'string') {
    return Result.mapError(renderedString(value, variables), (failure) => ({
      reason: 'argument',
      argument: path,
      failure,
    }));
  }
  if (!isJsonParent(value)) {
    return Result.succeed(value);
  }
  return Result.map(renderedEntries(childrenOf(value), variables, path), (rendered) =>
    isJsonArray(value) ? rendered.map(([, item]) => item) : Object.fromEntries(rendered),
  );
}

export function renderedArguments(
  templates: Templates,
  variables: TemplateVariables,
): Result.Result<RenderedArguments, ArgumentsFailure> {
  return Result.flatMap(renderedEntries(childrenOf(templates), variables, ''), (entries) => {
    const input = Object.fromEntries(entries);
    const bytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
    return bytes > toolBounds.argumentBytes
      ? Result.fail({ reason: 'too_large', bytes })
      : Result.succeed({ input, bytes });
  });
}

export interface DeliveryContext {
  readonly input: Schema.Json;
  readonly runId: string;
  readonly functionName: string;
}

export function deliveryVariablesOf(record: RequestRecord, { input, runId, functionName }: DeliveryContext) {
  const now = record.requested_at;
  return {
    input,
    today: now.slice(0, 10),
    now,
    to: record.to,
    message: record.message,
    run_id: runId,
    function: functionName,
    expires_at: record.expires_at,
    answer_schema: record.answer_schema ?? null,
  };
}
