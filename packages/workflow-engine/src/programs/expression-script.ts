export function expressionScript(body: string, names: readonly string[]): string {
  return `((${names.join(', ')}) => (\n${body}\n))`;
}
