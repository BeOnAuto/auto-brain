import { LiquidError, UndefinedVariableError } from 'liquidjs';

export interface EngineFailure {
  readonly line: number;
  readonly message: string;
  readonly cause: unknown;
  readonly missingVariable: string | undefined;
}

const positionSuffix = /, line:\d+, col:\d+$/u;

const undefinedVariable = /^undefined variable: /u;

export function lineAt(position: readonly number[], firstLine: number): number {
  return firstLine + Number(position[0]) - 1;
}

export function engineFailureOf(error: unknown, firstLine: number): EngineFailure {
  if (error instanceof LiquidError) {
    const message = error.message.replace(positionSuffix, '');
    return {
      line: lineAt(error.token.getPosition(), firstLine),
      message,
      cause: error.originalError,
      missingVariable: error instanceof UndefinedVariableError ? message.replace(undefinedVariable, '') : undefined,
    };
  }
  return { line: firstLine, message: String(error), cause: error, missingVariable: undefined };
}
