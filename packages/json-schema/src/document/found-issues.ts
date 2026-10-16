import { Schema, SchemaAST, SchemaIssue } from 'effect';

import { pointerOf, type SchemaIssue as Issue } from './json-bounds.ts';

export type Breach =
  | { readonly rule: 'kind' }
  | { readonly rule: 'missing' }
  | { readonly rule: 'unexpected' }
  | { readonly rule: 'bound'; readonly keywords: Schema.JsonObject };

export interface FoundIssue extends Issue {
  readonly breach?: Breach;
}

interface Leaf {
  readonly path: readonly PropertyKey[];
  readonly issue: SchemaIssue.Issue;
  readonly holder?: SchemaAST.AST | undefined;
}

type CheckBreach = (filter: SchemaAST.Filter<unknown>, holder: SchemaAST.AST | undefined) => Breach;

const detailOf = SchemaIssue.makeFormatterDefault();

const limitsOf = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Number));

const ofAnotherKind: Breach = { rule: 'kind' };

function boundNamed(keyword: string): CheckBreach {
  return (filter) => ({
    rule: 'bound',
    keywords: Object.fromEntries(
      Object.values(limitsOf(filter.annotations?.representation?.payload)).map((limit) => [keyword, limit]),
    ),
  });
}

function lengthOrItems(filter: SchemaAST.Filter<unknown>, holder: SchemaAST.AST | undefined): Breach {
  return boundNamed(holder !== undefined && SchemaAST.isString(holder) ? 'minLength' : 'minItems')(filter, holder);
}

const breachesOfChecks: ReadonlyMap<string | undefined, CheckBreach> = new Map<string | undefined, CheckBreach>([
  ['effect/schema/isMinCodePoints', boundNamed('minLength')],
  ['effect/schema/isMaxCodePoints', boundNamed('maxLength')],
  ['effect/schema/isMinLength', lengthOrItems],
  ['effect/schema/isMaxLength', boundNamed('maxItems')],
  ['effect/schema/isGreaterThanOrEqualTo', boundNamed('minimum')],
  ['effect/schema/isLessThanOrEqualTo', boundNamed('maximum')],
  ['effect/schema/isGreaterThan', boundNamed('exclusiveMinimum')],
  ['effect/schema/isLessThan', boundNamed('exclusiveMaximum')],
  ['effect/schema/isMultipleOf', boundNamed('multipleOf')],
  ['effect/schema/isMinProperties', boundNamed('minProperties')],
  ['effect/schema/isMaxProperties', boundNamed('maxProperties')],
  ['effect/schema/isUnique', () => ({ rule: 'bound', keywords: { uniqueItems: true } })],
  ['effect/schema/isInt', () => ofAnotherKind],
]);

function leavesOf(issue: SchemaIssue.Issue, path: readonly PropertyKey[], holder?: SchemaAST.AST): Leaf[] {
  if (issue instanceof SchemaIssue.Pointer) {
    return leavesOf(issue.issue, [...path, ...issue.path], holder);
  }
  if (issue instanceof SchemaIssue.Composite || (issue instanceof SchemaIssue.AnyOf && issue.issues.length > 0)) {
    return issue.issues.flatMap((inner) => leavesOf(inner, path, issue.ast));
  }
  if (issue instanceof SchemaIssue.Filter && !(issue.issue instanceof SchemaIssue.InvalidValue)) {
    return leavesOf(issue.issue, path, holder);
  }
  return [{ path, issue, holder }];
}

function isAValueWhereNoneIsAllowed(issue: SchemaIssue.Issue): boolean {
  return (
    issue instanceof SchemaIssue.UnexpectedKey ||
    (issue instanceof SchemaIssue.InvalidType && SchemaAST.isNever(issue.ast))
  );
}

function breachOfTheValue({ issue, holder }: Leaf): Breach | undefined {
  if (issue instanceof SchemaIssue.InvalidType || issue instanceof SchemaIssue.AnyOf) {
    return ofAnotherKind;
  }
  return issue instanceof SchemaIssue.Filter
    ? breachesOfChecks.get(issue.filter.annotations?.representation?.id)?.(issue.filter, holder)
    : undefined;
}

function breachOf(leaf: Leaf): Breach | undefined {
  if (leaf.issue instanceof SchemaIssue.MissingKey) {
    return { rule: 'missing' };
  }
  return isAValueWhereNoneIsAllowed(leaf.issue) ? { rule: 'unexpected' } : breachOfTheValue(leaf);
}

function foundOf(leaf: Leaf): FoundIssue {
  const found = { pointer: pointerOf(leaf.path), detail: detailOf(leaf.issue) };
  const breach = breachOf(leaf);
  return breach === undefined ? found : { ...found, breach };
}

export function foundIssuesOf(issue: SchemaIssue.Issue): readonly FoundIssue[] {
  return leavesOf(issue, []).map((leaf) => foundOf(leaf));
}
