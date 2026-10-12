const timestampLength = 6;

const randomLength = 10;

const markers: ReadonlyMap<number, (byte: number) => number> = new Map([
  [6, (byte: number) => 0x70 + (byte % 16)],
  [8, (byte: number) => 0x80 + (byte % 64)],
]);

function timestampBytesOf(milliseconds: number): readonly number[] {
  return Array.from(
    { length: timestampLength },
    (_, index) => Math.floor(milliseconds / 256 ** (timestampLength - 1 - index)) % 256,
  );
}

function hexOf(bytes: readonly number[]): string {
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidV7TimeOf(milliseconds: number): string {
  return milliseconds.toString(16).padStart(timestampLength * 2, '0');
}

export function uuidV7Before(id: string, milliseconds: number): boolean {
  return `${id.slice(0, 8)}${id.slice(9, 13)}` < uuidV7TimeOf(milliseconds);
}

export function randomUUIDv7(): string {
  const bytes = [...timestampBytesOf(Date.now()), ...crypto.getRandomValues(new Uint8Array(randomLength))];
  return hexOf(bytes.map((byte, index) => markers.get(index)?.(byte) ?? byte));
}
