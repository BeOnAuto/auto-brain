import type { Guide } from '@beonauto/api';

interface Row {
  readonly term: string;
  readonly meaning: string;
}

type Table = readonly Row[];

const separatorRow = /^\|[\s|:-]+\|$/u;

const tablesInOrder = ['capabilities', 'their descriptions', 'definitions and runs', 'supporting assets'];

function rowOf(line: string): Row {
  const [term, meaning] = line
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
  return { term: String(term), meaning: String(meaning) };
}

function tablesOf(page: string): readonly Table[] {
  return page
    .split(/\n\s*\n/u)
    .map((block) => block.trim().split('\n'))
    .filter((lines: readonly string[]) => lines.every((line) => line.startsWith('|')))
    .map((lines: readonly string[]) =>
      lines
        .filter((line) => !separatorRow.test(line))
        .slice(1)
        .map((line) => rowOf(line)),
    );
}

function tableAt(tables: readonly Table[], index: number): Table {
  const table = tables[index];
  if (table === undefined) {
    throw new Error(`The terminology page has no table of ${String(tablesInOrder[index])}`);
  }
  return table;
}

function plain(text: string): string {
  return text
    .replaceAll(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replaceAll(/\*\*|`/gu, '')
    .trim();
}

function asSentence(text: string): string {
  return /[.!?]$/u.test(text) ? text : `${text}.`;
}

function lineOf(term: string, meaning: string): string {
  return `- ${plain(term)}: ${plain(meaning)}`;
}

function isGiven(text: string | undefined): text is string {
  return text !== undefined;
}

export function terminologyGuideOf(page: string, served: readonly string[]): Guide {
  const tables = tablesOf(page);
  const capabilities = tableAt(tables, 0);
  const describing = new Map(tableAt(tables, 1).map(({ term, meaning }) => [term, meaning]));
  const functionTypes = capabilities
    .map(({ meaning }) => meaning.toLowerCase())
    .filter((resource) => resource.endsWith(' function'));
  const unserved = functionTypes.filter((type) => !served.includes(type));
  const namesNoneUnserved = ({ meaning }: Row) => !unserved.some((type) => meaning.toLowerCase().includes(type));
  const capabilityLines = capabilities
    .filter(({ meaning }) => served.includes(meaning.toLowerCase()))
    .map(({ term, meaning }) =>
      lineOf(
        term,
        [meaning, describing.get(term)]
          .filter((part) => isGiven(part))
          .map((part) => asSentence(part))
          .join(' '),
      ),
    );
  const termLines = (rows: Table) =>
    rows.filter((row) => namesNoneUnserved(row)).map(({ term, meaning }) => lineOf(term, asSentence(meaning)));
  return {
    name: 'terminology',
    title: 'Terminology',
    description: 'What the words of a brain mean: its capabilities, function types, definitions, runs and assets.',
    text: [
      '# Terminology',
      '',
      'The words of a brain, as its terminology gives them, to use with the person.',
      '',
      'The capabilities, the resource each one defines and what it does:',
      '',
      ...capabilityLines,
      '',
      'Definitions and runs:',
      '',
      ...termLines(tableAt(tables, 2)),
      '',
      'Supporting assets:',
      '',
      ...termLines(tableAt(tables, 3)),
      '',
    ].join('\n'),
  };
}
