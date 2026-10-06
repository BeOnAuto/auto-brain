export interface ProgramSpan {
  readonly start: number;
  readonly end: number;
}

export interface ProgramIssue {
  readonly detail: string;
  readonly span: ProgramSpan;
  readonly error?: string;
}

export function fieldOf(node: unknown, name: string): unknown {
  const value: unknown = Reflect.get(new Object(node), name);
  return value;
}

export function textOf(node: unknown, name: string): string {
  const text = fieldOf(node, name);
  return typeof text === 'string' ? text : '';
}

export function kindOf(node: unknown): string {
  return textOf(node, 'kind');
}

export function listOf(node: unknown, name: string): readonly unknown[] {
  const list = fieldOf(node, name);
  return Array.isArray(list) ? list : [];
}

function offsetOf(span: unknown, name: string): number {
  const offset = fieldOf(span, name);
  return typeof offset === 'number' ? offset : 0;
}

export function spanOf(node: unknown): ProgramSpan {
  const span = fieldOf(node, 'span');
  return { start: offsetOf(span, 'start'), end: offsetOf(span, 'end') };
}

export function issueOf(error: unknown): ProgramIssue {
  return { detail: textOf(error, 'message'), span: spanOf(error), error: textOf(error, 'name') };
}

export function nodesIn(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown) => nodesIn(item));
  }
  if (typeof value !== 'object' || value === null) {
    return [];
  }
  return kindOf(value) === '' ? Object.values(value).flatMap((member: unknown) => nodesIn(member)) : [value];
}

export function childrenOf(node: unknown, except: readonly string[] = []): readonly unknown[] {
  return Object.entries(new Object(node))
    .filter(([name]: readonly [string, unknown]) => name !== 'span' && !except.includes(name))
    .flatMap(([, value]: readonly [string, unknown]) => nodesIn(value));
}

export function nodesUnder(node: unknown): readonly unknown[] {
  return [node, ...childrenOf(node).flatMap((child) => nodesUnder(child))];
}
