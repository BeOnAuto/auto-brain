import { Tokenizer, TypeGuards } from 'liquidjs';

import { named, paragraph, type OverviewBlock, type Phrase } from './overview.ts';

export interface TextPiece {
  readonly kind: 'text';
  readonly text: string;
  readonly begin: number;
  readonly end: number;
}

interface OutputPiece {
  readonly kind: 'output';
  readonly content: string;
  readonly written: string;
  readonly begin: number;
  readonly end: number;
}

interface TagPiece {
  readonly kind: 'tag';
  readonly name: string;
  readonly args: string;
  readonly written: string;
  readonly begin: number;
  readonly end: number;
}

export type Piece = TextPiece | OutputPiece | TagPiece;

interface Line {
  readonly line: string;
}

const paragraphBreak = Symbol('paragraph break');

type Unit = Phrase | Line | typeof paragraphBreak;

const blockEnd = /^end[a-z]+$/u;

const endsOfReadBlocks: ReadonlySet<string> = new Set(['endif', 'endunless', 'endfor']);

const loop = /^\s*(?<item>[\w-]+)\s+in\s+(?<list>\S[\s\S]*)$/u;

function lastNameIn(content: string): string | undefined {
  const value = new Tokenizer(content).readValue();
  if (!TypeGuards.isPropertyAccessToken(value) || value.variable !== undefined) {
    return undefined;
  }
  let last: string | undefined;
  for (const segment of value.props) {
    if (TypeGuards.isWordToken(segment)) {
      last = segment.getText();
    } else if (TypeGuards.isQuotedToken(segment)) {
      last = segment.content;
    }
  }
  return last;
}

function asWritten(args: string): string {
  return args.trim().replaceAll(/\s+/gu, ' ');
}

function loopUnits(args: string, written: string): readonly Unit[] {
  const { item, list } = loop.exec(args)?.groups ?? {};
  return item === undefined || list === undefined
    ? [{ code: written }]
    : [{ line: `For each ${item} of ${asWritten(list)}:` }];
}

function blockEndUnits(name: string, written: string): readonly Unit[] {
  if (endsOfReadBlocks.has(name)) {
    return [paragraphBreak];
  }
  return blockEnd.test(name) ? [] : [{ code: written }];
}

function tagUnits({ name, args, written }: TagPiece): readonly Unit[] {
  switch (name) {
    case 'if': {
      return [{ line: `When ${asWritten(args)}:` }];
    }
    case 'unless': {
      return [{ line: `Unless ${asWritten(args)}:` }];
    }
    case 'elsif': {
      return [{ line: `Or when ${asWritten(args)}:` }];
    }
    case 'else': {
      return [{ line: 'Otherwise:' }];
    }
    case 'for': {
      return loopUnits(args, written);
    }
    case 'raw': {
      return [];
    }
    default: {
      return blockEndUnits(name, written);
    }
  }
}

function unitsOf(piece: Piece): readonly Unit[] {
  if (piece.kind === 'text') {
    return [piece.text];
  }
  if (piece.kind === 'tag') {
    return tagUnits(piece);
  }
  const name = lastNameIn(piece.content);
  return [name === undefined ? { code: piece.written } : named(name)];
}

function paragraphsIn(text: string): readonly string[] {
  const lines = text.split('\n');
  const last = lines.length - 1;
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (index > 0 && index < last && line.trim() === '') {
      paragraphs.push(current.join('\n'));
      current = [];
    } else {
      current.push(line);
    }
  }
  return [...paragraphs, current.join('\n')];
}

function marksOf(unit: Unit): readonly Unit[] {
  if (typeof unit !== 'string') {
    return [unit];
  }
  return paragraphsIn(unit).flatMap((part, index) => (index > 0 ? [paragraphBreak, part] : [part]));
}

function isLine(mark: Unit): mark is Line {
  return typeof mark === 'object' && 'line' in mark;
}

function merged(phrases: readonly Phrase[]): readonly Phrase[] {
  const joined: Phrase[] = [];
  for (const phrase of phrases) {
    const previous = joined.at(-1);
    if (typeof phrase === 'string' && typeof previous === 'string') {
      joined[joined.length - 1] = `${previous}${phrase}`;
    } else {
      joined.push(phrase);
    }
  }
  return joined;
}

function trimmed(phrases: readonly Phrase[]): readonly Phrase[] {
  const whole = merged(phrases);
  const last = whole.length - 1;
  return whole
    .map((phrase, index) => {
      if (typeof phrase !== 'string') {
        return phrase;
      }
      const started = index === 0 ? phrase.trimStart() : phrase;
      return index === last ? started.trimEnd() : started;
    })
    .filter((phrase) => phrase !== '');
}

export function blocksOf(pieces: readonly Piece[]): readonly OverviewBlock[] {
  const blocks: OverviewBlock[] = [];
  let current: Phrase[] = [];
  const close = (): void => {
    const phrases = trimmed(current);
    blocks.push(...(phrases.length > 0 ? [paragraph(...phrases)] : []));
    current = [];
  };
  for (const mark of pieces.flatMap((piece) => unitsOf(piece)).flatMap((unit) => marksOf(unit))) {
    if (mark === paragraphBreak) {
      close();
    } else if (isLine(mark)) {
      close();
      blocks.push(paragraph({ emphasis: mark.line }));
    } else {
      current.push(mark);
    }
  }
  close();
  return blocks;
}
