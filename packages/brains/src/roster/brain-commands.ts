export interface BrainCreation {
  readonly type: 'create';
  readonly brain: string;
  readonly name: string;
  readonly description: string;
}

export interface BrainUpdate {
  readonly type: 'update';
  readonly brain: string;
  readonly name: string;
  readonly description: string;
}

export interface BrainRetirement {
  readonly type: 'retire';
  readonly brain: string;
}

export type BrainIntent = BrainCreation | BrainUpdate | BrainRetirement;

export interface Stamp {
  readonly by: string;
  readonly at: string;
}

export type BrainCommand = BrainIntent & Stamp;
