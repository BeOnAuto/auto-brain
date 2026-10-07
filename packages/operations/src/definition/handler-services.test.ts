import { describe, expectTypeOf, it } from 'vitest';

import type {
  BrainAddress,
  BrainProjectionReader,
  BrainRecordedReader,
  BrainRunOutcomesReader,
  BrainRegistry,
  BrainReader,
  BrainContext,
  BrainWriter,
  HandlerServices,
  IncidentReporter,
  Ledger,
  OrgAddress,
  OrgReader,
  OrgContext,
  OrgWriter,
  StreamReader,
  StreamWriter,
} from '../index.ts';

describe('the services a handler may ask for', () => {
  it('give an org handler nothing of a brain', () => {
    expectTypeOf<BrainContext>().not.toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<BrainReader>().not.toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<BrainWriter>().not.toExtend<HandlerServices<'org', 'command'>>();
  });

  it('give a brain handler nothing of its org beyond the address of the call', () => {
    expectTypeOf<OrgContext>().not.toExtend<HandlerServices<'brain', 'command'>>();
    expectTypeOf<OrgReader>().not.toExtend<HandlerServices<'brain', 'command'>>();
    expectTypeOf<OrgWriter>().not.toExtend<HandlerServices<'brain', 'command'>>();
  });

  it('give the writer of a scope to its commands only', () => {
    expectTypeOf<OrgWriter>().not.toExtend<HandlerServices<'org', 'query'>>();
    expectTypeOf<OrgWriter>().toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<BrainWriter>().not.toExtend<HandlerServices<'brain', 'query'>>();
    expectTypeOf<BrainWriter>().toExtend<HandlerServices<'brain', 'command'>>();
  });

  it('never include the unbound ledger, the brain registry or the incident reporter', () => {
    expectTypeOf<Ledger | BrainRegistry | IncidentReporter>().not.toExtend<HandlerServices<'org', 'query'>>();
    expectTypeOf<Ledger>().not.toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<Ledger>().not.toExtend<HandlerServices<'brain', 'query'>>();
    expectTypeOf<Ledger>().not.toExtend<HandlerServices<'brain', 'command'>>();
    expectTypeOf<BrainRegistry>().not.toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<BrainRegistry>().not.toExtend<HandlerServices<'brain', 'command'>>();
    expectTypeOf<IncidentReporter>().not.toExtend<HandlerServices<'org', 'command'>>();
    expectTypeOf<IncidentReporter>().not.toExtend<HandlerServices<'brain', 'command'>>();
  });

  it('bind every port a handler sees to the org or brain of the call', () => {
    expectTypeOf<OrgContext['Service']>().toEqualTypeOf<OrgAddress>();
    expectTypeOf<BrainContext['Service']>().toEqualTypeOf<BrainAddress>();
    expectTypeOf<OrgReader['Service']>().toEqualTypeOf<StreamReader>();
    expectTypeOf<OrgWriter['Service']>().toEqualTypeOf<StreamWriter>();
    expectTypeOf<BrainReader['Service']>().toEqualTypeOf<
      StreamReader & BrainRecordedReader & BrainRunOutcomesReader & BrainProjectionReader
    >();
    expectTypeOf<BrainWriter['Service']>().toEqualTypeOf<StreamWriter>();
  });
});
