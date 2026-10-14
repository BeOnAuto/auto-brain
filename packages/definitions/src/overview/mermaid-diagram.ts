import { oneLine } from './markdown-text.ts';
import type { Diagram, DiagramEdge, DiagramGroup, DiagramNode, NodeShape } from './overview.ts';

const entityOfCharacter: ReadonlyMap<string, string> = new Map([
  ['#', '#35;'],
  ['"', '#34;'],
  ['&', '#38;'],
  ['<', '#60;'],
  ['>', '#62;'],
  ['`', '#96;'],
  ['|', '#124;'],
]);

const charactersWithEntities = /[#"&<>`|]/gu;

const bracketsOfShape: Readonly<Record<NodeShape, readonly [string, string]>> = {
  step: ['[', ']'],
  decision: ['{', '}'],
  terminal: ['([', '])'],
  cylinder: ['[(', ')]'],
};

const indentStep = '  ';

function quoted(label: string): string {
  const escaped = oneLine(label)
    .trim()
    .replaceAll(charactersWithEntities, (character) => String(entityOfCharacter.get(character)));
  return `"${escaped}"`;
}

function nodeId(index: number): string {
  return `n${index + 1}`;
}

function nodeLine({ label, shape = 'step' }: DiagramNode, index: number, indent: string): string {
  const [open, close] = bracketsOfShape[shape];
  return `${indent}${nodeId(index)}${open}${quoted(label)}${close}`;
}

function edgeLine({ from, to, label, dashed = false }: DiagramEdge): string {
  const line = dashed ? '-.->' : '-->';
  const arrow = label === undefined ? line : `${line}|${quoted(label)}|`;
  return `  ${nodeId(from)} ${arrow} ${nodeId(to)}`;
}

function groupOfEachNode({ groups = [] }: Diagram): ReadonlyMap<number, number> {
  const groupOf = new Map<number, number>();
  for (const [group, { nodes }] of groups.entries()) {
    for (const node of nodes.filter((member) => !groupOf.has(member))) {
      groupOf.set(node, group);
    }
  }
  return groupOf;
}

function enclosingOf({ within }: DiagramGroup, group: number): number | undefined {
  return within !== undefined && within >= 0 && within < group ? within : undefined;
}

interface Placing {
  readonly diagram: Diagram;
  readonly groupOf: ReadonlyMap<number, number>;
}

function groupLines({ diagram, groupOf }: Placing, group: number, label: string, indent: string): readonly string[] {
  const { nodes, groups = [] } = diagram;
  const inner = `${indent}${indentStep}`;
  return [
    `${indent}subgraph g${group + 1}[${quoted(label)}]`,
    ...nodes.flatMap((node, index) => (groupOf.get(index) === group ? [nodeLine(node, index, inner)] : [])),
    ...groups.flatMap((child, index) =>
      enclosingOf(child, index) === group ? groupLines({ diagram, groupOf }, index, child.label, inner) : [],
    ),
    `${indent}end`,
  ];
}

export function mermaidOf(diagram: Diagram): string {
  const { nodes, edges, groups = [] } = diagram;
  const placing = { diagram, groupOf: groupOfEachNode(diagram) };
  const grouped = groups.flatMap((group, index) =>
    enclosingOf(group, index) === undefined ? groupLines(placing, index, group.label, indentStep) : [],
  );
  const ungrouped = nodes.flatMap((node, index) =>
    placing.groupOf.has(index) ? [] : [nodeLine(node, index, indentStep)],
  );
  return ['```mermaid', 'flowchart LR', ...grouped, ...ungrouped, ...edges.map((edge) => edgeLine(edge)), '```'].join(
    '\n',
  );
}
