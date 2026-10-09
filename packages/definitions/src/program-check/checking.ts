import type { CheckAnswer, CheckIssue, CheckJob } from '@beonauto/workflow-engine/worker';
import { Function } from 'effect';
import ts from 'typescript6';

import { locatedIn } from './diagnostics.ts';
import { contractOf, contractIssues, type Contract } from './entry-contracts.ts';
import { expressionIssues } from './expression-issues.ts';
import { expressionsFileOf } from './expressions-file.ts';
import { exportedFunctions, moduleRuleIssues, type Place } from './module-rules.ts';
import type { SandboxLib } from './sandbox-lib.ts';
import { declarationOf, eventDeclaration, jsonType } from './schema-types.ts';

export type Check = (job: CheckJob) => CheckAnswer;

interface CheckedModule {
  readonly place: Place;
  readonly file: () => ts.SourceFile;
  readonly contract: Contract;
  readonly contractFile: () => ts.SourceFile;
}

const checkedFiles = {
  lib: '/sandbox.d.ts',
  iterator: '/sandbox-iterator.d.ts',
  declarations: '/declarations.d.ts',
  program: '/program.ts',
  contract: '/contract.ts',
  expressions: '/expressions.ts',
};

const options: ts.CompilerOptions = {
  strict: true,
  exactOptionalPropertyTypes: true,
  isolatedModules: true,
  erasableSyntaxOnly: true,
  allowImportingTsExtensions: true,
  noEmit: true,
  noLib: true,
  types: [],
  target: ts.ScriptTarget.ES2025,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  moduleDetection: ts.ModuleDetectionKind.Force,
};

const placeTypes: Readonly<Record<Place, readonly (keyof CheckJob['schemas'])[]>> = {
  computation: ['input', 'output'],
  recall: ['view', 'input', 'output'],
};

const typeNames: Readonly<Record<keyof CheckJob['schemas'], string>> = {
  input: 'Input',
  output: 'Output',
  view: 'View',
};

function declarationsOf({ module, schemas }: CheckJob): string {
  const types =
    module === undefined ? [] : placeTypes[module.place].map((name) => declarationOf(typeNames[name], schemas[name]));
  const event = module?.place === 'recall' ? [eventDeclaration] : [];
  return [jsonType, ...types, ...event].join('\n');
}

function hostOf(files: () => ReadonlyMap<string, ts.SourceFile>): ts.CompilerHost {
  const known = files();
  return {
    getSourceFile: known.get.bind(known),
    getDefaultLibFileName: () => checkedFiles.lib,
    writeFile: Function.constVoid,
    getCurrentDirectory: () => '/',
    getCanonicalFileName: Function.identity,
    useCaseSensitiveFileNames: () => true,
    getNewLine: Function.constant('\n'),
    fileExists: known.has.bind(known),
    readFile: Function.constUndefined,
  };
}

function sourceFileOf(name: string, text: string): ts.SourceFile {
  return ts.createSourceFile(name, text, ts.ScriptTarget.ES2025, true);
}

function moduleIssues(
  program: ts.Program,
  { file, place, contract, contractFile }: CheckedModule,
): readonly CheckIssue[] {
  const compiled = locatedIn(file, () => [
    ...program.getSyntacticDiagnostics(file()),
    ...program.getSemanticDiagnostics(file()),
  ]);
  const contracted = contractIssues(
    locatedIn(contractFile, () => program.getSemanticDiagnostics(contractFile())),
    contract,
  );
  return [...compiled, ...moduleRuleIssues(file, place), ...contracted].map(({ line, detail }): CheckIssue => ({
    at: 'module',
    line,
    detail,
  }));
}

function checkedModuleOf(job: CheckJob): CheckedModule | undefined {
  if (job.module === undefined) {
    return undefined;
  }
  const file = sourceFileOf(checkedFiles.program, job.module.source);
  const contract = contractOf(
    exportedFunctions(() => file),
    job.module.place,
  );
  const contractFile = sourceFileOf(checkedFiles.contract, contract.text);
  return { place: job.module.place, file: () => file, contract, contractFile: () => contractFile };
}

function filesOf(lib: SandboxLib): (job: CheckJob, checked: CheckedModule | undefined) => Map<string, ts.SourceFile> {
  const script = sourceFileOf(checkedFiles.lib, lib.script);
  const iterator = sourceFileOf(checkedFiles.iterator, lib.iterator);
  return (job, checked) => {
    const files = new Map([
      [checkedFiles.lib, script],
      [checkedFiles.iterator, iterator],
      [checkedFiles.declarations, sourceFileOf(checkedFiles.declarations, declarationsOf(job))],
    ]);
    if (checked !== undefined) {
      files.set(checkedFiles.program, checked.file());
      files.set(checkedFiles.contract, checked.contractFile());
    }
    return files;
  };
}

export function checkerOf(lib: SandboxLib): Check {
  const filesFor = filesOf(lib);
  return (job) => {
    const placed = expressionsFileOf(job.expressions);
    const expressions = sourceFileOf(checkedFiles.expressions, placed.text);
    const checked = checkedModuleOf(job);
    const files = filesFor(job, checked);
    files.set(checkedFiles.expressions, expressions);
    const program = ts.createProgram(
      [...files.keys()],
      options,
      hostOf(() => files),
    );
    const expressionsFile = () => expressions;
    return {
      ran: 'checked',
      issues: [
        ...(checked === undefined ? [] : moduleIssues(program, checked)),
        ...expressionIssues(expressionsFile, placed, {
          syntactic: locatedIn(expressionsFile, () => program.getSyntacticDiagnostics(expressions)),
          semantic: () => locatedIn(expressionsFile, () => program.getSemanticDiagnostics(expressions)),
        }),
      ],
    };
  };
}
