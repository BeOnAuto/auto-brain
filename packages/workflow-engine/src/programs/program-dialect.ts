import { childrenOf, fieldOf, kindOf, listOf, nodesUnder, spanOf, textOf, type ProgramIssue } from './program-tree.ts';

export interface Refusal {
  readonly name: string;
  readonly why: string;
}

export interface Dialect {
  readonly refused: readonly Refusal[];
  readonly variables?: readonly string[];
}

interface Scope {
  readonly functions: ReadonlySet<string>;
  readonly variables: ReadonlySet<string>;
}

interface Checking {
  readonly why: ReadonlyMap<string, string>;
  readonly unbound: (name: string, node: unknown) => readonly ProgramIssue[];
}

type Check = (node: unknown, scope: Scope, checking: Checking) => readonly ProgramIssue[];

const keywordsOfSyntax: ReadonlyMap<string, string> = new Map([
  ['Label', 'label'],
  ['Break', 'break'],
]);

const emptyScope: Scope = { functions: new Set(), variables: new Set() };

function signature(name: string, arity: number): string {
  return `${name}/${arity}`;
}

function issueAt(node: unknown, detail: string): readonly ProgramIssue[] {
  return [{ detail, span: spanOf(node) }];
}

function withVariables(scope: Scope, pattern: unknown): Scope {
  const bound = nodesUnder(pattern)
    .filter((node) => kindOf(node) === 'VariablePattern')
    .map((node) => textOf(node, 'name'));
  return { ...scope, variables: new Set([...scope.variables, ...bound]) };
}

function withFunctions(scope: Scope, signatures: readonly string[]): Scope {
  return { ...scope, functions: new Set([...scope.functions, ...signatures]) };
}

function issuesIn(node: unknown, scope: Scope, checking: Checking): readonly ProgramIssue[] {
  const keyword = keywordsOfSyntax.get(kindOf(node));
  const why = keyword === undefined ? undefined : checking.why.get(keyword);
  const refusedSyntax = keyword === undefined || why === undefined ? [] : issueAt(node, `${keyword} ${why}`);
  const check = checks.get(kindOf(node)) ?? childIssues;
  return [...refusedSyntax, ...check(node, scope, checking)];
}

function allIssuesIn(nodes: readonly unknown[], scope: Scope, checking: Checking): readonly ProgramIssue[] {
  return nodes.flatMap((node) => issuesIn(node, scope, checking));
}

function childIssues(node: unknown, scope: Scope, checking: Checking): readonly ProgramIssue[] {
  return allIssuesIn(childrenOf(node), scope, checking);
}

function variableIssues(node: unknown, scope: Scope, { why, unbound }: Checking): readonly ProgramIssue[] {
  const name = textOf(node, 'name');
  if (scope.variables.has(name)) {
    return [];
  }
  const refusal = why.get(`$${name}`);
  return refusal === undefined ? unbound(name, node) : issueAt(node, `$${name} ${refusal}`);
}

function callIssues(node: unknown, scope: Scope, checking: Checking): readonly ProgramIssue[] {
  const name = textOf(node, 'name');
  const args = listOf(node, 'args');
  const refusal = scope.functions.has(signature(name, args.length)) ? undefined : checking.why.get(name);
  return [...(refusal === undefined ? [] : issueAt(node, `${name} ${refusal}`)), ...allIssuesIn(args, scope, checking)];
}

function bindingIssues(node: unknown, scope: Scope, checking: Checking): readonly ProgramIssue[] {
  return [
    ...issuesIn(fieldOf(node, 'bind'), scope, checking),
    ...issuesIn(fieldOf(node, 'body'), withVariables(scope, fieldOf(node, 'pattern')), checking),
  ];
}

function foldIssues(node: unknown, scope: Scope, checking: Checking): readonly ProgramIssue[] {
  const inside = withVariables(scope, fieldOf(node, 'pattern'));
  return [
    ...allIssuesIn([fieldOf(node, 'source'), fieldOf(node, 'init')], scope, checking),
    ...allIssuesIn(childrenOf(node, ['source', 'init', 'pattern']), inside, checking),
  ];
}

function definitionIssues(node: unknown, scope: Scope, checking: Checking): readonly ProgramIssue[] {
  const parameters = listOf(node, 'args').map((parameter) => signature(String(parameter), 0));
  const defined = withFunctions(scope, [signature(textOf(node, 'name'), parameters.length)]);
  return [
    ...issuesIn(fieldOf(node, 'body'), withFunctions(defined, parameters), checking),
    ...issuesIn(fieldOf(node, 'next'), defined, checking),
  ];
}

const checks: ReadonlyMap<string, Check> = new Map<string, Check>([
  ['Var', variableIssues],
  ['Call', callIssues],
  ['As', bindingIssues],
  ['Reduce', foldIssues],
  ['Foreach', foldIssues],
  ['Def', definitionIssues],
]);

function byPlace(first: ProgramIssue, second: ProgramIssue): number {
  return first.span.start - second.span.start;
}

export function dialectIssues(program: unknown, { refused, variables }: Dialect): readonly ProgramIssue[] {
  const given = variables === undefined ? undefined : new Set(variables);
  const checking: Checking = {
    why: new Map(refused.map(({ name, why }: Refusal) => [name, why])),
    unbound: (name, node) =>
      given === undefined || given.has(name)
        ? []
        : issueAt(node, `$${name} is not defined; bind it with as, reduce or foreach before using it`),
  };
  return issuesIn(program, emptyScope, checking).toSorted(byPlace);
}

export function freeVariablesIn(program: unknown): readonly string[] {
  const checking: Checking = { why: new Map(), unbound: (name, node) => issueAt(node, name) };
  const unbound = issuesIn(program, emptyScope, checking).toSorted(byPlace);
  return [...new Set(unbound.map(({ detail }) => detail))];
}
