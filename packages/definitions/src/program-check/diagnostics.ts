import ts from 'typescript6';

const settingsAdvice = / Do you need to .*$/u;

export interface Located {
  readonly line: number;
  readonly detail: string;
}

export function locatedIn(file: () => ts.SourceFile, found: () => readonly ts.Diagnostic[]): readonly Located[] {
  const located: Located[] = [];
  for (const { start = 0, messageText } of found()) {
    located.push({
      line: file().getLineAndCharacterOfPosition(start).line + 1,
      detail: ts.flattenDiagnosticMessageText(messageText, ' ').replaceAll(/\s+/gu, ' ').replace(settingsAdvice, ''),
    });
  }
  return located;
}
