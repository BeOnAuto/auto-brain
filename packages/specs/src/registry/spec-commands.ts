import type { SpecContent } from './spec-events.ts';

export interface SpecCreation {
  readonly type: 'create';
  readonly name: string;
  readonly content: SpecContent;
}

export interface SpecUpdate {
  readonly type: 'update';
  readonly name: string;
  readonly content: SpecContent;
}

export interface SpecRetirement {
  readonly type: 'retire';
  readonly name: string;
}

export type SpecCommandData = SpecCreation | SpecUpdate | SpecRetirement;

export interface CommandMetadata {
  readonly by: string;
  readonly at: string;
}

export type SpecCommand = SpecCommandData & CommandMetadata;
