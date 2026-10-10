export const bytesPerToken = 3;

const utf8 = new TextEncoder();

export interface SpentStep {
  readonly usage: { readonly inputTokens?: number | undefined };
}

export function answerRoom(
  contextWindow: number | undefined,
  maxOutputTokens: number,
  messages: unknown,
): number | undefined {
  if (contextWindow === undefined) {
    return undefined;
  }
  const sent = utf8.encode(JSON.stringify(messages)).byteLength;
  return Math.max(0, (contextWindow - maxOutputTokens) * bytesPerToken - sent);
}

export function inputTokensOf(steps: readonly SpentStep[]): number {
  let spent = 0;
  for (const { usage } of steps) {
    spent += usage.inputTokens ?? 0;
  }
  return spent;
}
