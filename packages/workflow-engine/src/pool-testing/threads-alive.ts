import { Schema } from 'effect';

const decodeReport = Schema.decodeUnknownSync(Schema.Struct({ workers: Schema.Array(Schema.Unknown) }));

export function threadsAlive(): number {
  return decodeReport(process.report.getReport()).workers.length;
}
