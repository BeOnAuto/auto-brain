import { Schema } from 'effect';

const forbiddenCharacter = /[\p{Cc}\p{Cs}\p{Noncharacter_Code_Point}]/u;

export const forbiddenCharactersInWords = 'control characters, unpaired surrogates or noncharacters';

export function holdsNoForbiddenCharacter(text: string): boolean {
  return !forbiddenCharacter.test(text);
}

export const refusingForbiddenCharacters = Schema.makeFilter(holdsNoForbiddenCharacter, {
  expected: `text without ${forbiddenCharactersInWords}`,
});

export const mostReferenceBytes = 256;

const utf8 = new TextEncoder();

function isWithinTheReferenceBound(reference: string): boolean {
  return utf8.encode(reference).byteLength <= mostReferenceBytes;
}

export const refusingLongReferences = Schema.makeFilter(isWithinTheReferenceBound, {
  expected: `a reference of at most ${mostReferenceBytes} bytes in UTF-8`,
});

const ContextText = Schema.String.check(refusingForbiddenCharacters);

const ContextReference = ContextText.check(refusingLongReferences);

const Counted = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

export const CalledBySchema = Schema.Struct({ runId: ContextText, reference: ContextReference, run: Counted });

export type CalledBy = typeof CalledBySchema.Type;

export const StartingTriggerSchema = Schema.Struct({
  kind: Schema.Literals(['event', 'cron', 'every']),
  reference: ContextReference,
});

export type StartingTrigger = typeof StartingTriggerSchema.Type;

export const ContextSchema = Schema.Struct({
  at: ContextText,
  by: ContextText,
  runId: Schema.optionalKey(ContextText),
  definitionType: Schema.optionalKey(ContextText),
  definitionName: Schema.optionalKey(ContextText),
  definitionVersion: Schema.optionalKey(Counted),
  calledBy: Schema.optionalKey(CalledBySchema),
  callDepth: Schema.optionalKey(Counted),
  depth: Schema.optionalKey(Counted),
  trigger: Schema.optionalKey(StartingTriggerSchema),
});

export type Context = typeof ContextSchema.Type;

const readContext = Schema.decodeUnknownSync(ContextSchema);

export function contextOf(metadata: unknown): Context {
  return readContext(metadata);
}

export function checkedContext(context: Context): Context {
  return readContext(context);
}
