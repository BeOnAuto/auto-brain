import type { InvalidCursorKind } from '@beonauto/operations';
import { Option, Result, Schema } from 'effect';

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

export function pointOf(
  cursor: string,
  brainKey: string,
  pointLength: number,
): Result.Result<RecordedPoint, InvalidCursorKind> {
  return Option.match(decodeCursor(cursor), {
    onNone: () => Result.fail('malformed'),
    onSome: ([key, ...point]) => {
      if (point.length !== pointLength || !point.every((part) => isPosition(part))) {
        return Result.fail('malformed');
      }
      return key === brainKey ? Result.succeed(point) : Result.fail('of_another_brain');
    },
  });
}
