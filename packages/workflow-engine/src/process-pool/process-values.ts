import { Buffer } from 'node:buffer';

export type TypedArray = Readonly<
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array
>;

export type ProcessValue =
  | null
  | boolean
  | number
  | string
  | TypedArray
  | readonly ProcessValue[]
  | { readonly [name: string]: ProcessValue };

interface TypedKind {
  readonly bytesEach: number;
  readonly of: (bytes: Readonly<ArrayBuffer>) => TypedArray;
}

const typedKinds: ReadonlyMap<string, TypedKind> = new Map<string, TypedKind>([
  ['Int8Array', { bytesEach: Int8Array.BYTES_PER_ELEMENT, of: (bytes) => new Int8Array(bytes) }],
  ['Uint8Array', { bytesEach: Uint8Array.BYTES_PER_ELEMENT, of: (bytes) => new Uint8Array(bytes) }],
  [
    'Uint8ClampedArray',
    { bytesEach: Uint8ClampedArray.BYTES_PER_ELEMENT, of: (bytes) => new Uint8ClampedArray(bytes) },
  ],
  ['Int16Array', { bytesEach: Int16Array.BYTES_PER_ELEMENT, of: (bytes) => new Int16Array(bytes) }],
  ['Uint16Array', { bytesEach: Uint16Array.BYTES_PER_ELEMENT, of: (bytes) => new Uint16Array(bytes) }],
  ['Int32Array', { bytesEach: Int32Array.BYTES_PER_ELEMENT, of: (bytes) => new Int32Array(bytes) }],
  ['Uint32Array', { bytesEach: Uint32Array.BYTES_PER_ELEMENT, of: (bytes) => new Uint32Array(bytes) }],
  ['Float32Array', { bytesEach: Float32Array.BYTES_PER_ELEMENT, of: (bytes) => new Float32Array(bytes) }],
  ['Float64Array', { bytesEach: Float64Array.BYTES_PER_ELEMENT, of: (bytes) => new Float64Array(bytes) }],
  ['BigInt64Array', { bytesEach: BigInt64Array.BYTES_PER_ELEMENT, of: (bytes) => new BigInt64Array(bytes) }],
  ['BigUint64Array', { bytesEach: BigUint64Array.BYTES_PER_ELEMENT, of: (bytes) => new BigUint64Array(bytes) }],
]);

const typedKey = '$typed';

const base64Key = 'base64';

function isTypedArray(value: ProcessValue): value is TypedArray {
  return ArrayBuffer.isView(value);
}

function isList(value: ProcessValue): value is readonly ProcessValue[] {
  return Array.isArray(value);
}

function base64Of(typed: TypedArray): string {
  return Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
}

export function wireOf(value: ProcessValue): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (isTypedArray(value)) {
    return { [typedKey]: value[Symbol.toStringTag], [base64Key]: base64Of(value) };
  }
  if (isList(value)) {
    return value.map((each) => wireOf(each));
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, each]: readonly [string, ProcessValue]) => [name, wireOf(each)]),
  );
}

function typedOf(kind: TypedKind | undefined, text: unknown): TypedArray | undefined {
  if (kind === undefined || typeof text !== 'string') {
    return undefined;
  }
  const decoded = Buffer.from(text, 'base64');
  if (decoded.byteLength % kind.bytesEach !== 0) {
    return undefined;
  }
  const bytes = new Uint8Array(decoded.byteLength);
  bytes.set(decoded);
  return kind.of(bytes.buffer);
}

function isTypedWire(entries: readonly (readonly [string, unknown])[]): boolean {
  return (
    entries.length === 2 && entries.some(([name]) => name === typedKey) && entries.some(([name]) => name === base64Key)
  );
}

type Entry = readonly [string, ProcessValue];

function isKnown(value: ProcessValue | undefined): value is ProcessValue {
  return value !== undefined;
}

function valuesOf(wire: readonly unknown[]): readonly ProcessValue[] | undefined {
  const values = wire.map((each) => valueOf(each)).filter((each) => isKnown(each));
  return values.length === wire.length ? values : undefined;
}

function entryOf([name, each]: readonly [string, unknown]): readonly Entry[] {
  const value = valueOf(each);
  return value === undefined ? [] : [[name, value]];
}

function objectOf(entries: readonly (readonly [string, unknown])[]): ProcessValue | undefined {
  const values = entries.flatMap((entry) => entryOf(entry));
  return values.length === entries.length ? Object.fromEntries(values) : undefined;
}

export function valueOf(wire: unknown): ProcessValue | undefined {
  if (wire === null || typeof wire === 'boolean' || typeof wire === 'number' || typeof wire === 'string') {
    return wire;
  }
  if (Array.isArray(wire)) {
    return valuesOf(wire);
  }
  if (typeof wire !== 'object') {
    return undefined;
  }
  const entries: readonly (readonly [string, unknown])[] = Object.entries(wire);
  if (!isTypedWire(entries)) {
    return objectOf(entries);
  }
  const kind: unknown = Reflect.get(wire, typedKey);
  return typedOf(typeof kind === 'string' ? typedKinds.get(kind) : undefined, Reflect.get(wire, base64Key));
}
