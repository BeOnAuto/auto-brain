import type { JSONValue, ModelMessage as SdkMessage } from 'ai';
import type { Schema } from 'effect';

import type { GenerationSettings, ModelMessage, ModelRequest, ProviderOptions } from '../model/model-request.ts';

type MutableObject = Record<string, JSONValue>;

function isList(value: Schema.Json): value is readonly Schema.Json[] {
  return Array.isArray(value);
}

function isObject(value: Schema.Json): value is Schema.JsonObject {
  return typeof value === 'object' && value !== null && !isList(value);
}

function mutableObject(value: Schema.JsonObject): MutableObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]: readonly [string, Schema.Json]) => [key, mutableJson(entry)]),
  );
}

function mutableJson(value: Schema.Json): JSONValue {
  if (isList(value)) {
    return value.map((entry) => mutableJson(entry));
  }
  return isObject(value) ? mutableObject(value) : value;
}

function sdkMessage(message: ModelMessage): SdkMessage {
  const content = message.content.map((part) => ({ type: 'text' as const, text: part.text }));
  return message.role === 'user' ? { role: 'user', content } : { role: 'assistant', content };
}

export function promptOf(request: ModelRequest) {
  return {
    ...(request.instructions === undefined ? {} : { instructions: request.instructions }),
    messages: request.messages.map((message) => sdkMessage(message)),
  };
}

export function callSettingsOf(settings: GenerationSettings) {
  return {
    maxOutputTokens: settings.max_output_tokens,
    ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
    ...(settings.top_p === undefined ? {} : { topP: settings.top_p }),
    ...(settings.seed === undefined ? {} : { seed: settings.seed }),
    ...(settings.stop_sequences === undefined ? {} : { stopSequences: [...settings.stop_sequences] }),
    ...(settings.reasoning === undefined ? {} : { reasoning: settings.reasoning }),
  };
}

export function providerOptionsOf(options: ProviderOptions | undefined) {
  if (options === undefined) {
    return {};
  }
  const providerOptions: Record<string, MutableObject> = Object.fromEntries(
    Object.entries(options).map(([namespace, values]: readonly [string, Schema.JsonObject]) => [
      namespace,
      mutableObject(values),
    ]),
  );
  return { providerOptions };
}

export function retriesOf(request: ModelRequest): number {
  return request.retries === 'caller' ? 0 : 2;
}
