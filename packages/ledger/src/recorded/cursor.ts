import { Option, Schema } from 'effect';

import type { RecordedPoint } from '../event-store.ts';

const largestPosition = 2n ** 63n - 1n;

const CursorSchema = Schema.StringFromBase64Url.pipe(
  Schema.decodeTo(Schema.fromJsonString(Schema.Array(Schema.String))),
);

const decodeCursor = Schema.decodeUnknownOption(CursorSchema);

const encodeCursor = Schema.encodeSync(CursorSchema);

const decimal = /^(?:0|[1-9]\d{0,18})$/u;

function isPosition(part: string): boolean {
  return decimal.test(part) && BigInt(part) <= largestPosition;
}

export function cursorOf(brainKey: string, point: RecordedPoint): string {
  return encodeCursor([brainKey, ...point]);
}

export function pointOf(cursor: string, brainKey: string, pointLength: number): Option.Option<RecordedPoint> {
  return Option.flatMap(decodeCursor(cursor), ([key, ...point]) =>
    key === brainKey && point.length === pointLength && point.every((part) => isPosition(part))
      ? Option.some(point)
      : Option.none(),
  );
}
