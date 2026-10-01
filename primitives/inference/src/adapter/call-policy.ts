import type { ModelRequest } from '../model/model-request.ts';
import type { ReportProviderMessage } from './model-access-options.ts';

export interface CallPolicy {
  readonly configured: readonly string[];
  readonly showsProviderMessages: (provider: string) => boolean;
  readonly scrub: (text: string) => string;
  readonly report: ReportProviderMessage;
}

const leastQuotedCharacters = 8;

function promptTextsOf({ instructions, messages }: ModelRequest): readonly string[] {
  const texts = [instructions ?? '', ...messages.flatMap(({ content }) => content.map(({ text }) => text))];
  return texts.map((text) => text.trim()).filter((text) => text.length >= leastQuotedCharacters);
}

export function scrubberFor(policy: CallPolicy, request: ModelRequest): (text: string) => string {
  const prompts = promptTextsOf(request);
  return (text) => policy.scrub(prompts.reduce((scrubbed, prompt) => scrubbed.replaceAll(prompt, '[prompt]'), text));
}
