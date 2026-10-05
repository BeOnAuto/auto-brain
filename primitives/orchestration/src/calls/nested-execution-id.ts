import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

const nestedExecutions = Buffer.from('9b1f3a526c0d4b8e9f273e5d1c7a2b40', 'hex');

export function nestedExecutionId(runId: string, reference: string, run: number): string {
  const hash = createHash('sha1').update(nestedExecutions).update(`${runId}${reference}#${run}`, 'utf8').digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.toString('hex', 0, 16);
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-');
}
