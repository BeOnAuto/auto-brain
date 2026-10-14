import { oneLine } from './markdown-text.ts';
import type { Diagram, DiagramEdge, DiagramNode } from './overview.ts';

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

function quoted(label: string): string {
  const escaped = oneLine(label)
    .trim()
    .replaceAll(charactersWithEntities, (character) => String(entityOfCharacter.get(character)));
  return `"${escaped}"`;
}

function nodeId(index: number): string {
  return `n${index + 1}`;
}

function nodeLine({ label }: DiagramNode, index: number, indent: string): string {
  return `${indent}${nodeId(index)}[${quoted(label)}]`;
}

function edgeLine({ from, to, label }: DiagramEdge): string {
  const arrow = label === undefined ? '-->' : `-->|${quoted(label)}|`;
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

export function mermaidOf(diagram: Diagram): string {
  const { nodes, edges, groups = [] } = diagram;
  const groupOf = groupOfEachNode(diagram);
  const grouped = groups.flatMap(({ label }, group) =>
    [`  subgraph g${group + 1}[${quoted(label)}]`].concat(
      nodes.flatMap((node, index) => (groupOf.get(index) === group ? [nodeLine(node, index, '    ')] : [])),
      ['  end'],
    ),
  );
  const ungrouped = nodes.flatMap((node, index) => (groupOf.has(index) ? [] : [nodeLine(node, index, '  ')]));
  return ['```mermaid', 'flowchart LR', ...grouped, ...ungrouped, ...edges.map((edge) => edgeLine(edge)), '```'].join(
    '\n',
  );
}
