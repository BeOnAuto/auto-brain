import { registerHooks, type ResolveFnOutput, type ResolveHookSync } from 'node:module';

interface ResolvingContext {
  readonly conditions: readonly string[];
  readonly importAttributes: Readonly<Record<string, string | undefined>>;
  readonly parentURL: string | undefined;
}

const swc = /^@swc\/core(?:$|[-/])/u;

function resolveWithoutSwc(
  specifier: string,
  context: ResolvingContext,
  nextResolve: Parameters<ResolveHookSync>[2],
): ResolveFnOutput {
  if (swc.test(specifier)) {
    throw new Error(`Cannot find module '${specifier}', as in an image installed without optional dependencies`);
  }
  return nextResolve(specifier, { ...context, conditions: [...context.conditions] });
}

export function registerWithoutSwc(): void {
  registerHooks({ resolve: resolveWithoutSwc });
}
