const utf8 = new TextEncoder();

export interface TurnSent {
  readonly instructions?: unknown;
  readonly messages: unknown;
  readonly tools?: unknown;
}

export interface TurnAnswered {
  readonly usage: { readonly inputTokens?: number | undefined; readonly outputTokens?: number | undefined };
  readonly content: readonly { readonly type: string }[];
}

interface Turn {
  readonly sentBytes: number;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number;
  readonly calls: number;
  readonly answeredBytes: number;
}

interface RatedTurn extends Turn {
  readonly inputTokens: number;
  readonly bytesPerToken: number;
}

export interface TurnLimits {
  readonly contextWindow: number | undefined;
  readonly mostInputTokens: number;
}

export interface TurnMeter {
  readonly started: (sent: TurnSent) => void;
  readonly ended: (answered: TurnAnswered) => void;
  readonly answered: (text: string) => void;
  readonly roomOfEachAnswer: () => number | undefined;
  readonly leavesNoNextTurn: () => boolean;
  readonly lastInputTokens: () => number | null;
}

function bytesOf(value: unknown): number {
  return utf8.encode(JSON.stringify(value)).byteLength;
}

function ratedOf(turn: Turn | undefined): RatedTurn | undefined {
  if (turn?.inputTokens === undefined || turn.inputTokens <= 0) {
    return undefined;
  }
  return { ...turn, inputTokens: turn.inputTokens, bytesPerToken: turn.sentBytes / turn.inputTokens };
}

function measured({ instructions, messages, tools }: TurnSent): Turn {
  return {
    sentBytes: bytesOf({ instructions, messages, tools }),
    inputTokens: undefined,
    outputTokens: 0,
    calls: 0,
    answeredBytes: 0,
  };
}

function reported(turn: Turn, { usage, content }: TurnAnswered): Turn {
  return {
    ...turn,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens ?? 0,
    calls: content.filter(({ type }) => type === 'tool-call').length,
  };
}

function answeredMore(turn: Turn, text: string): Turn {
  return { ...turn, answeredBytes: turn.answeredBytes + utf8.encode(text).byteLength };
}

function roomOfEach(turn: RatedTurn, mostNextInput: number): number {
  const roomTokens = mostNextInput - turn.inputTokens - turn.outputTokens;
  return Math.max(0, Math.floor((roomTokens * turn.bytesPerToken) / Math.max(1, turn.calls)));
}

export function turnMeter({ contextWindow, mostInputTokens }: TurnLimits): TurnMeter {
  const turns: Turn[] = [];
  const spent = (): number => turns.reduce((total, { inputTokens = 0 }) => total + inputTokens, 0);
  const changeLast = (change: (turn: Turn) => Turn): void => {
    const turn = turns.pop();
    if (turn !== undefined) {
      turns.push(change(turn));
    }
  };
  return {
    started: (sent) => {
      turns.push(measured(sent));
    },
    ended: (answered) => {
      changeLast((turn) => reported(turn, answered));
    },
    answered: (text) => {
      changeLast((turn) => answeredMore(turn, text));
    },
    roomOfEachAnswer: () => {
      const turn = ratedOf(turns.at(-1));
      return turn === undefined || contextWindow === undefined
        ? undefined
        : roomOfEach(turn, Math.min(contextWindow, mostInputTokens - spent()));
    },
    leavesNoNextTurn: () => {
      const turn = ratedOf(turns.at(-1));
      if (turn === undefined) {
        return false;
      }
      const projected = turn.inputTokens + turn.outputTokens + turn.answeredBytes / turn.bytesPerToken;
      return mostInputTokens - spent() - projected < projected;
    },
    lastInputTokens: () => turns.findLast(({ inputTokens }) => inputTokens !== undefined)?.inputTokens ?? null,
  };
}
