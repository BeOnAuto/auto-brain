import { bytesOf, canonicalJson, cutAtCodePoint } from './text-bytes.ts';

export const toolBounds = {
  callsInRun: 25,
  resultBytesInRun: 262_144,
  resultBytes: 65_536,
  argumentBytes: 16_384,
  sameCallsInRun: 2,
  failuresInRun: 5,
  longestRetryWaitMs: 10_000,
  callMs: 30_000,
  openMs: 10_000,
  runMs: 600_000,
  descriptionBytes: 4096,
  recordedContentBytes: 4096,
} as const;

export interface Timing {
  readonly callMs: number;
  readonly openMs: number;
  readonly longestRetryWaitMs: number;
}

export const defaultTiming: Timing = {
  callMs: toolBounds.callMs,
  openMs: toolBounds.openMs,
  longestRetryWaitMs: toolBounds.longestRetryWaitMs,
};

export interface CallTally {
  readonly calls: number;
  readonly resultBytes: number;
  readonly failures: number;
  readonly sameCalls: ReadonlyMap<string, readonly string[]>;
}

export interface CallAsked {
  readonly tool: string;
  readonly callId: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export type Admission =
  | { readonly admitted: true; readonly tally: CallTally }
  | { readonly admitted: false; readonly tally: CallTally; readonly refusal: string };

export interface ShownResult {
  readonly tally: CallTally;
  readonly text: string;
}

export const noCalls: CallTally = { calls: 0, resultBytes: 0, failures: 0, sameCalls: new Map() };

const allCallsMade = `This run has made all the ${toolBounds.callsInRun} tool calls it may; answer from what you have.`;

const allResultsReceived = `This run has received all the ${toolBounds.resultBytesInRun} bytes of tool results it may; answer from what you have.`;

function argumentsTooLarge(bytes: number): string {
  return `The arguments of this call take ${bytes} bytes, more than the ${toolBounds.argumentBytes} a call may send; send less.`;
}

function repeated(earlier: readonly string[]): string {
  return `This call repeats, with the same arguments, a call this run already made ${toolBounds.sameCallsInRun} times; use the answer to the call ${String(earlier.at(-1))} instead.`;
}

function refusalOf(tally: CallTally, argumentBytes: number, earlier: readonly string[]): string | undefined {
  if (tally.calls > toolBounds.callsInRun) {
    return allCallsMade;
  }
  if (tally.resultBytes >= toolBounds.resultBytesInRun) {
    return allResultsReceived;
  }
  if (argumentBytes > toolBounds.argumentBytes) {
    return argumentsTooLarge(argumentBytes);
  }
  return earlier.length >= toolBounds.sameCallsInRun ? repeated(earlier) : undefined;
}

export function admission(tally: CallTally, { tool, callId, input }: CallAsked): Admission {
  const counted = { ...tally, calls: tally.calls + 1 };
  const key = `${tool}\u0000${canonicalJson(input)}`;
  const earlier = tally.sameCalls.get(key) ?? [];
  const refusal = refusalOf(counted, bytesOf(JSON.stringify(input)), earlier);
  return refusal === undefined
    ? { admitted: true, tally: { ...counted, sameCalls: new Map([...tally.sameCalls, [key, [...earlier, callId]]]) } }
    : { admitted: false, tally: counted, refusal };
}

function cutNote(room: number, bytes: number): string {
  return `\n[The answer was cut to ${room} of its ${bytes} bytes; ask for fewer rows, fields or depth to see the rest.]`;
}

export function shownResult(tally: CallTally, text: string): ShownResult {
  const room = Math.min(toolBounds.resultBytes, toolBounds.resultBytesInRun - tally.resultBytes);
  const bytes = bytesOf(text);
  const note = cutNote(room, bytes);
  const shown = bytes <= room ? text : `${cutAtCodePoint(text, room - bytesOf(note))}${note}`;
  return { tally: { ...tally, resultBytes: tally.resultBytes + bytesOf(shown) }, text: shown };
}

export function failedOnce(tally: CallTally): CallTally {
  return { ...tally, failures: tally.failures + 1 };
}

export function failuresEnded({ failures }: CallTally): boolean {
  return failures >= toolBounds.failuresInRun;
}

export function callsEnded({ calls, resultBytes }: CallTally): boolean {
  return calls >= toolBounds.callsInRun || resultBytes >= toolBounds.resultBytesInRun;
}

export function runBoundMs(stepDeadlineMs: number): number {
  return Math.max(toolBounds.runMs, stepDeadlineMs);
}
