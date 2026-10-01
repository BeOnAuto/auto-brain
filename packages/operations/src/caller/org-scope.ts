import { Context } from 'effect';

export interface OrgAddress {
  readonly org: string;
}

export class OrgScope extends Context.Service<OrgScope, OrgAddress>()('@beonauto/operations/OrgScope') {}
