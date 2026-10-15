export type UserRelation = 'calls' | 'sends-builds' | 'asks-approval' | 'remembers-runs' | 'remembers-changes';

export interface NamedDefinition {
  readonly type: string;
  readonly name: string;
}

export interface DefinitionUser extends NamedDefinition {
  readonly relation: UserRelation;
}
