import { describe, expect, it } from 'vitest';

import {
  admission,
  callsEnded,
  defaultTiming,
  failedOnce,
  failuresEnded,
  noCalls,
  runBoundMs,
  shownResult,
  toolBounds,
  type CallTally,
} from './call-bounds.ts';
import { bytesOf } from './text-bytes.ts';

type Input = Readonly<Record<string, unknown>>;

const asked = (callId: string, input: Input) => ({ tool: 'mcp__graph__search', callId, input });

const searched = (callId: string) => asked(callId, { query: callId });

function admittedTally(tally: CallTally, callId: string, input: Input): CallTally {
  return admission(tally, asked(callId, input)).tally;
}

describe('admitting a call', () => {
  it('admits a call and counts it', () => {
    expect(admission(noCalls, searched('call-1'))).toMatchObject({
      admitted: true,
      tally: { calls: 1, resultBytes: 0, failures: 0 },
    });
  });

  it('refuses the call after the twenty-fifth, still counting it', () => {
    const tally = Array.from({ length: 25 }, (_, index) => `call-${index}`).reduce(
      (each, callId) => admittedTally(each, callId, { query: callId }),
      noCalls,
    );

    expect(callsEnded(tally)).toBe(true);
    expect(admission(tally, searched('call-26'))).toEqual({
      admitted: false,
      tally: { ...tally, calls: 26 },
      refusal: 'This run has made all the 25 tool calls it may; answer from what you have.',
    });
  });

  it('refuses a call once the results of the run fill their budget', () => {
    const full = { ...noCalls, resultBytes: toolBounds.resultBytesInRun };

    expect(callsEnded(full)).toBe(true);
    expect(admission(full, searched('call-1'))).toMatchObject({
      admitted: false,
      refusal: 'This run has received all the 262144 bytes of tool results it may; answer from what you have.',
    });
  });
});

describe('admitting the arguments of a call', () => {
  it('refuses arguments over 16 KiB', () => {
    expect(admission(noCalls, asked('call-1', { query: 'x'.repeat(16_384) }))).toMatchObject({
      admitted: false,
      refusal: 'The arguments of this call take 16396 bytes, more than the 16384 a call may send; send less.',
    });
  });

  it('refuses the third call with the same arguments in any order, naming the earlier answer', () => {
    const once = admittedTally(noCalls, 'call-1', { a: 1, b: [2, { d: 4, c: 3 }] });
    const twice = admittedTally(once, 'call-2', { b: [2, { c: 3, d: 4 }], a: 1 });

    expect(admission(twice, asked('call-3', { a: 1, b: [2, { c: 3, d: 4 }] }))).toMatchObject({
      admitted: false,
      refusal:
        'This call repeats, with the same arguments, a call this run already made 2 times; use the answer to the call call-2 instead.',
    });
    expect(admission(twice, asked('call-3', { a: 2 }))).toMatchObject({ admitted: true });
  });
});

describe('showing a result', () => {
  it('shows a result within its bound whole and counts its bytes', () => {
    expect(shownResult(noCalls, 'Found 2 rows.')).toEqual({
      tally: { ...noCalls, resultBytes: 13 },
      text: 'Found 2 rows.',
    });
  });

  it('cuts a result over 64 KiB at a code point, with the note', () => {
    const shown = shownResult(noCalls, '😀'.repeat(20_000));

    expect(bytesOf(shown.text)).toBeLessThanOrEqual(toolBounds.resultBytes);
    expect(shown.text).toMatch(
      /^(?:😀)+\n\[The answer was cut to 65536 of its 80000 bytes; ask for fewer rows, fields or depth to see the rest\.\]$/u,
    );
    expect(shown.tally.resultBytes).toBe(bytesOf(shown.text));
  });

  it('cuts a result to what is left of the budget of the run', () => {
    const shown = shownResult({ ...noCalls, resultBytes: toolBounds.resultBytesInRun - 200 }, 'x'.repeat(300));

    expect(shown.text).toMatch(/^x+\n\[The answer was cut to 200 of its 300 bytes;/u);
    expect(shown.tally.resultBytes).toBe(toolBounds.resultBytesInRun);
  });
});

describe('the failures and the time of a run', () => {
  it('ends the calls after five server failures', () => {
    const four = [1, 2, 3, 4].reduce((tally) => failedOnce(tally), noCalls);

    expect(failuresEnded(four)).toBe(false);
    expect(failuresEnded(failedOnce(four))).toBe(true);
  });

  it('bounds a run by ten minutes, or one step when that is longer', () => {
    expect(runBoundMs(60_000)).toBe(600_000);
    expect(runBoundMs(1_660_000)).toBe(1_660_000);
    expect(defaultTiming).toEqual({ callMs: 30_000, openMs: 10_000, longestRetryWaitMs: 10_000 });
  });
});
