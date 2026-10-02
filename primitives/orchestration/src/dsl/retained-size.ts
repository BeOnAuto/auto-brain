const stringBytes = 32;

const scalarBytes = 16;

const slotBytes = 16;

const arrayBytes = 128;

const objectBytes = 160;

const entryBytes = 64;

const sizes = new WeakMap<object, number>();

export function retainedBytesOf(value: unknown): number {
  if (typeof value === 'string') {
    return stringBytes + 2 * value.length;
  }
  if (Array.isArray(value)) {
    return containerBytes(value, () =>
      value.reduce((sum: number, item: unknown) => sum + slotBytes + retainedBytesOf(item), arrayBytes),
    );
  }
  if (typeof value === 'object' && value !== null) {
    return containerBytes(value, () =>
      Object.entries(value).reduce(
        (sum: number, [key, item]: readonly [string, unknown]) =>
          sum + entryBytes + retainedBytesOf(key) + retainedBytesOf(item),
        objectBytes,
      ),
    );
  }
  return scalarBytes;
}

function containerBytes(value: object, sum: () => number): number {
  const known = sizes.get(value);
  if (known !== undefined) {
    return known;
  }
  const bytes = sum();
  sizes.set(value, bytes);
  return bytes;
}
