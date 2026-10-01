export type Json = null | boolean | number | string | JsonArray | JsonObject;

export interface JsonArray extends ReadonlyArray<Json> {}

export interface JsonObject {
  readonly [key: string]: Json;
}

export type JsonEntry = readonly [string, Json];

export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isList(value: Json | undefined): value is JsonArray {
  return Array.isArray(value);
}

export function field(object: JsonObject, key: string): Json | undefined {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

export function textField(object: JsonObject, key: string): string | undefined {
  const value = field(object, key);
  return typeof value === 'string' ? value : undefined;
}

export function objectField(object: JsonObject, key: string): JsonObject | undefined {
  const value = field(object, key);
  return isObject(value) ? value : undefined;
}

export function listField(object: JsonObject, key: string): JsonArray | undefined {
  const value = field(object, key);
  return isList(value) ? value : undefined;
}

export function entriesOf(object: JsonObject): readonly JsonEntry[] {
  return Object.entries(object);
}

export function isTruthy(value: Json): boolean {
  return value !== null && value !== false;
}

export function jsonEquals(left: Json | undefined, right: Json | undefined): boolean {
  if (isList(left) && isList(right)) {
    return left.length === right.length && left.every((item, index) => jsonEquals(item, right[index]));
  }
  if (isObject(left) && isObject(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => jsonEquals(left[key], right[key]));
  }
  return left === right;
}

export function jsonBytesOf(value: Json): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((item: unknown) => isJson(item));
  }
  return isPlainObject(value) && Object.values(value).every((item: unknown) => isJson(item));
}

function isPlainObject(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
