import { describe, expect, it } from 'vitest';

import { turnMeter, type TurnAnswered, type TurnSent } from './turn-meter.ts';

const sent: TurnSent = {
  instructions: 'Answer from the rows the tools give.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Summarize acme, é and all.' }] }],
  tools: [{ name: 'mcp__graph__search', description: 'Finds rows.' }],
};

const sentBytes = new TextEncoder().encode(JSON.stringify(sent)).byteLength;

function answeredWith(inputTokens: number | undefined, outputTokens: number | undefined, calls: number): TurnAnswered {
  const toolCalls = Array.from({ length: calls }, () => ({ type: 'tool-call' }));
  return { usage: { inputTokens, outputTokens }, content: [{ type: 'text' }, ...toolCalls] };
}

function measuredTurn(limits: Parameters<typeof turnMeter>[0], answered: TurnAnswered, turn: TurnSent = sent) {
  const turns = turnMeter(limits);
  turns.started(turn);
  turns.ended(answered);
  return turns;
}

describe('the room of the answers of a turn', () => {
  it('is what the window holds past the input and output the provider reported, in bytes at the ratio the turn measured', () => {
    const turns = measuredTurn({ contextWindow: 1000, mostInputTokens: 2_000_000 }, answeredWith(40, 10, 1));

    expect(turns.roomOfEachAnswer()).toBe(Math.floor((1000 - 40 - 10) * (sentBytes / 40)));
  });

  it('counts the instructions and the tools a turn sends in the bytes of its ratio', () => {
    const bare = measuredTurn({ contextWindow: 1000, mostInputTokens: 2_000_000 }, answeredWith(40, 10, 1), {
      messages: sent.messages,
    });
    const whole = measuredTurn({ contextWindow: 1000, mostInputTokens: 2_000_000 }, answeredWith(40, 10, 1));

    expect(Number(whole.roomOfEachAnswer())).toBeGreaterThan(Number(bare.roomOfEachAnswer()));
  });

  it('is shared equally by the calls of the turn', () => {
    const one = measuredTurn({ contextWindow: 9000, mostInputTokens: 2_000_000 }, answeredWith(30, 0, 1));
    const three = measuredTurn({ contextWindow: 9000, mostInputTokens: 2_000_000 }, answeredWith(30, 0, 3));

    expect(three.roomOfEachAnswer()).toBe(Math.floor(Number(one.roomOfEachAnswer()) / 3));
  });

  it('is bounded by what the budget of the run leaves, counting every turn made, and is none when nothing is left', () => {
    const turns = measuredTurn({ contextWindow: 1_000_000, mostInputTokens: 200 }, answeredWith(40, 10, 1));
    turns.started(sent);
    turns.ended(answeredWith(60, 10, 2));

    expect(turns.roomOfEachAnswer()).toBe(Math.floor(((200 - 100 - 60 - 10) * (sentBytes / 60)) / 2));
    expect(measuredTurn({ contextWindow: 50, mostInputTokens: 200 }, answeredWith(40, 10, 1)).roomOfEachAnswer()).toBe(
      0,
    );
  });

  it('is none for a turn the provider counted no input tokens of, or of a model whose window is unknown', () => {
    expect([
      measuredTurn(
        { contextWindow: 1000, mostInputTokens: 200 },
        answeredWith(undefined, undefined, 1),
      ).roomOfEachAnswer(),
      measuredTurn({ contextWindow: 1000, mostInputTokens: 200 }, answeredWith(0, 5, 1)).roomOfEachAnswer(),
      measuredTurn({ contextWindow: undefined, mostInputTokens: 200 }, answeredWith(40, 5, 1)).roomOfEachAnswer(),
      turnMeter({ contextWindow: 1000, mostInputTokens: 200 }).roomOfEachAnswer(),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('the budget of the input tokens of a run, before a turn', () => {
  it('leaves no next turn when what it would leave after one is less than the turn it projects', () => {
    const answered = answeredWith(40, 10, 1);
    const roomy = measuredTurn({ contextWindow: undefined, mostInputTokens: 1000 }, answered);
    const tight = measuredTurn({ contextWindow: undefined, mostInputTokens: 150 }, answered);
    roomy.answered('x'.repeat(sentBytes));
    tight.answered('x'.repeat(sentBytes));

    expect([roomy.leavesNoNextTurn(), tight.leavesNoNextTurn()]).toEqual([false, true]);
  });

  it('projects nothing before the first turn, nor for a turn the provider counted no input tokens of', () => {
    const unreported = turnMeter({ contextWindow: 1000, mostInputTokens: 10 });
    unreported.answered('an answer before any turn');
    unreported.ended(answeredWith(5, 5, 1));
    unreported.started(sent);
    unreported.ended(answeredWith(undefined, 5, 1));

    expect([
      turnMeter({ contextWindow: 1000, mostInputTokens: 10 }).leavesNoNextTurn(),
      unreported.leavesNoNextTurn(),
    ]).toEqual([false, false]);
  });

  it('counts a turn the provider counted nothing of as no input when it sums the turns made', () => {
    const turns = turnMeter({ contextWindow: undefined, mostInputTokens: 130 });
    turns.started(sent);
    turns.ended(answeredWith(undefined, 0, 1));
    turns.started(sent);
    turns.ended(answeredWith(40, 0, 1));

    expect(turns.leavesNoNextTurn()).toBe(false);
  });
});

describe('the input tokens of the last turn the provider answered', () => {
  it('are none before a turn was counted, and the last count after', () => {
    const turns = turnMeter({ contextWindow: 1000, mostInputTokens: 200 });
    const before = turns.lastInputTokens();
    turns.started(sent);
    turns.ended(answeredWith(40, 10, 1));
    turns.started(sent);
    turns.ended(answeredWith(undefined, 10, 1));

    expect([before, turns.lastInputTokens()]).toEqual([null, 40]);
  });
});
