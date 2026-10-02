export const internalTerms: readonly RegExp[] = [
  /\bspecs?\b/iu,
  /\bprimitives?\b/iu,
  /\bexecutions?\b/iu,
  /\binference\b/iu,
  /\borchestration\b/iu,
  /\bya?ml\b/iu,
  /\bjson\b/iu,
  /\bliquid\b/iu,
  /\bschemas?\b/iu,
  /\bfront matter\b/iu,
  /\benums?\b/iu,
  /\bidempotent\b/iu,
  /\b[1-5]\d{2}\b/u,
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/u,
  /\b[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\b/iu,
  /\S\/\S/u,
];

export function internalTermsIn(text: string): readonly string[] {
  const found: string[] = [];
  for (const term of internalTerms) {
    const match = term.exec(text);
    if (match !== null) {
      found.push(match[0]);
    }
  }
  return found;
}
