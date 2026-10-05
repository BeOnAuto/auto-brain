import type { ModelMessage } from 'ai';
import { Option, Schema } from 'effect';

interface StepPart {
  readonly type: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly input?: unknown;
  readonly output?: unknown;
}

export interface StepMessage {
  readonly role: string;
  readonly content: string | readonly StepPart[];
}

export const toolsWithdrawn =
  'The tools of this run are no longer available; answer from what the tools answered above, without calling any.';

const decodeOutput = Schema.decodeUnknownOption(Schema.Struct({ type: Schema.String, value: Schema.Unknown }));

function valueText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function answerText({ toolName, output }: StepPart): string {
  return Option.match(decodeOutput(output), {
    onNone: () => `${String(toolName)} answered nothing.`,
    onSome: ({ type, value }) =>
      type.startsWith('error')
        ? `${String(toolName)} failed: ${valueText(value)}`
        : `${String(toolName)} answered: ${valueText(value)}`,
  });
}

function partText(part: StepPart): string | undefined {
  if (part.type === 'text') {
    return part.text;
  }
  if (part.type === 'tool-call') {
    return `Called ${String(part.toolName)} with ${JSON.stringify(part.input)}.`;
  }
  return part.type === 'tool-result' ? answerText(part) : undefined;
}

function textOf(content: string | readonly StepPart[]): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map((part) => partText(part))
    .filter((text) => text !== undefined)
    .join('\n');
}

function said(role: string, text: string): ModelMessage {
  if (role === 'system') {
    return { role: 'system', content: text };
  }
  const content = [{ type: 'text' as const, text }];
  return role === 'assistant' ? { role: 'assistant', content } : { role: 'user', content };
}

interface Turn {
  readonly role: string;
  readonly text: string;
}

function merged(told: readonly Turn[]): readonly Turn[] {
  const turns: Turn[] = [];
  for (const turn of told) {
    const last = turns.at(-1);
    if (last !== undefined && last.role === turn.role && turn.role !== 'system') {
      turns.splice(-1, 1, { role: turn.role, text: `${last.text}\n\n${turn.text}` });
    } else {
      turns.push(turn);
    }
  }
  return turns;
}

export function finalStepMessages(messages: readonly StepMessage[]): ModelMessage[] {
  const told = messages
    .map(({ role, content }): Turn => ({ role: role === 'tool' ? 'user' : role, text: textOf(content) }))
    .filter(({ text }) => text.trim() !== '');
  return merged([...told, { role: 'user', text: toolsWithdrawn }]).map(({ role, text }) => said(role, text));
}
