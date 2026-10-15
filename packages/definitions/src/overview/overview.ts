interface Name {
  readonly name: string;
}

interface Emphasis {
  readonly emphasis: string;
}

interface Code {
  readonly code: string;
}

export type Phrase = string | Name | Emphasis | Code;

export type Phrases = readonly Phrase[];

export interface Paragraph {
  readonly kind: 'paragraph';
  readonly phrases: Phrases;
}

export interface BulletList {
  readonly kind: 'list';
  readonly items: readonly Phrases[];
}

export interface FieldRow {
  readonly name: string;
  readonly required: boolean;
  readonly words: Phrases;
}

export interface FieldTable {
  readonly kind: 'fields';
  readonly rows: readonly FieldRow[];
}

export interface DiagramNode {
  readonly label: string;
  readonly shape?: 'cylinder';
}

export interface DiagramEdge {
  readonly from: number;
  readonly to: number;
  readonly label?: string;
}

export interface DiagramGroup {
  readonly label: string;
  readonly nodes: readonly number[];
}

export interface Diagram {
  readonly kind: 'diagram';
  readonly nodes: readonly DiagramNode[];
  readonly edges: readonly DiagramEdge[];
  readonly groups?: readonly DiagramGroup[];
}

export type OverviewBlock = Paragraph | BulletList | FieldTable | Diagram;

export interface OverviewSection {
  readonly heading: string;
  readonly blocks: readonly OverviewBlock[];
}

export interface Overview {
  readonly title: string;
  readonly opening: Phrases;
  readonly sections: readonly OverviewSection[];
}

export function named(name: string): Name {
  return { name };
}

export function paragraph(...phrases: Phrases): Paragraph {
  return { kind: 'paragraph', phrases };
}

export function bulletList(items: readonly Phrases[]): BulletList {
  return { kind: 'list', items };
}

export function sectionOf(heading: string, ...blocks: readonly OverviewBlock[]): OverviewSection {
  return { heading, blocks };
}
