import { escapedInline, oneLine, phrasesText } from './markdown-text.ts';
import { mermaidOf } from './mermaid-diagram.ts';
import { named, type FieldRow, type FieldTable, type Overview, type OverviewBlock, type Phrases } from './overview.ts';

export const mostOverviewBytes = 65_536;

export const mostTableRows = 50;

const counted = new Intl.NumberFormat('en');

const cutLine = `*The overview stops here, at the ${counted.format(mostOverviewBytes)} bytes an overview may take; the whole definition is under Source.*`;

const blockSeparator = '\n\n';

const utf8 = new TextEncoder();

function bytesOf(text: string): number {
  return utf8.encode(text).byteLength;
}

function tableRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function fieldRow({ name, required, words }: FieldRow): string {
  return tableRow([phrasesText([named(name)], 'cell'), required ? 'yes' : 'no', phrasesText(words, 'cell').trim()]);
}

function fieldTableText({ rows }: FieldTable): string {
  const more = rows.length - mostTableRows;
  return [
    tableRow(['Field', 'Required', 'What it is']),
    tableRow(['---', '---', '---']),
    ...rows.slice(0, mostTableRows).map((row) => fieldRow(row)),
    ...(more > 0 ? [tableRow([`and ${more} more`, '', ''])] : []),
  ].join('\n');
}

function itemsText(items: readonly Phrases[], markerOf: (index: number) => string): string {
  return items.map((item, index) => `${markerOf(index)} ${oneLine(phrasesText(item, 'prose')).trim()}`).join('\n');
}

function blockText(block: OverviewBlock): string {
  if (block.kind === 'paragraph') {
    return phrasesText(block.phrases, 'prose');
  }
  if (block.kind === 'list') {
    return itemsText(block.items, () => '-');
  }
  if (block.kind === 'numbered') {
    return itemsText(block.items, (index) => `${index + 1}.`);
  }
  return block.kind === 'fields' ? fieldTableText(block) : mermaidOf(block);
}

function blocksWithin(blocks: readonly string[]): readonly string[] {
  if (bytesOf(blocks.join(blockSeparator)) + 1 <= mostOverviewBytes) {
    return blocks;
  }
  const room = mostOverviewBytes - 1 - bytesOf(cutLine) - blockSeparator.length;
  const kept: string[] = [];
  let taken = 0;
  for (const block of blocks) {
    taken += bytesOf(block) + (kept.length > 0 ? blockSeparator.length : 0);
    if (taken > room) {
      break;
    }
    kept.push(block);
  }
  return [...kept, cutLine];
}

export function markdownOf({ title, opening, sections }: Overview): string {
  const blocks = [
    `# ${escapedInline(title)}`,
    phrasesText(opening, 'prose'),
    ...sections.flatMap(({ heading, blocks: sectionBlocks }) => [
      `## ${escapedInline(heading)}`,
      ...sectionBlocks.map((block) => blockText(block)),
    ]),
  ];
  return `${blocksWithin(blocks).join(blockSeparator)}\n`;
}
