import type { Json } from '@beonauto/workflow-engine';
import { describe, expect, it } from 'vitest';

import { triggerOfSource } from './workflow-document.ts';
import { scheduleRejections, triggerOfDocument } from './workflow-schedule.ts';

function refused(schedule: Json): readonly string[] {
  return scheduleRejections(schedule, '/schedule').map(({ pointer, detail }) => `${pointer}: ${detail}`);
}

const typed = { with: { type: 'com.acme.closed' } };

describe('the schedule of a workflow, which names its trigger', () => {
  it('is a mapping of one of on, cron and every', () => {
    expect([
      refused('daily'),
      refused({}),
      refused({ every: 'PT1M', cron: '0 9 * * *' }),
      refused({ every: 'PT1M', at: 'noon' }),
      refused({ after: 'PT1M' }),
    ]).toEqual([
      ['/schedule: schedule is a mapping that names the trigger of the workflow: on, cron or every'],
      ['/schedule: A workflow has one trigger: its schedule names one of on, cron and every'],
      ['/schedule: A workflow has one trigger: its schedule names one of on, cron and every'],
      ['/schedule/at: schedule takes on, cron or every, not at'],
      [
        '/schedule/after: A workflow is not started again after its run ends: give it a trigger with on, cron or every instead',
      ],
    ]);
  });

  it('every is a duration of a minute or more', () => {
    expect([
      refused({ every: 'PT1M' }),
      refused({ every: { hours: 2 } }),
      refused({ every: 'PT30S' }),
      refused({ every: 'soon' }),
    ]).toEqual([
      [],
      [],
      ['/schedule/every: A schedule is due at most once a minute, not every 30000 ms'],
      ['/schedule/every: soon is not an ISO 8601 duration'],
    ]);
  });

  it('cron is text of five fields that name a time that comes', () => {
    expect([refused({ cron: '30 2 * * 1-5' }), refused({ cron: 5 }), refused({ cron: '61 2 * * *' })]).toEqual([
      [],
      ['/schedule/cron: cron is text of five fields, minute, hour, day of month, month and day of week'],
      ['/schedule/cron: The cron expression 61 2 * * * cannot be read: CronPattern: Invalid value for minute: 61'],
    ]);
  });
});

describe('the events that start a workflow', () => {
  it('are one filter or any of a list of filters, each naming the type of its events', () => {
    expect([
      refused({ on: { one: typed } }),
      refused({ on: { any: [typed, { with: { type: 'com.acme.opened', data: { region: 'eu' } } }] } }),
      refused({ on: { any: [typed, { with: { source: '/ledger' } }] } }),
    ]).toEqual([
      [],
      [],
      [
        '/schedule/on/any/1/with/type: An event filter matched over the event alone names the type of the events it takes',
      ],
    ]);
  });

  it('are neither all of a list, nor none, nor until something, nor matched with the variables of a run', () => {
    const correlated = { with: { type: 'com.acme.closed', data: '${ .ticket == $workflow.input.ticket }' } };

    expect([
      refused({ on: 'events' }),
      refused({ on: {} }),
      refused({ on: { any: [] } }),
      refused({ on: { all: [typed] } }),
      refused({ on: { one: typed, until: { one: typed } } }),
      refused({ on: { one: correlated } }),
    ]).toEqual([
      ['/schedule/on: on takes one, a filter of the events that start the workflow, or any, a list of at least one'],
      ['/schedule/on: on takes one, a filter of the events that start the workflow, or any, a list of at least one'],
      ['/schedule/on: on takes one, a filter of the events that start the workflow, or any, a list of at least one'],
      [
        '/schedule/on/all: A trigger starts a run for every event that matches it, so it takes one or any; all, which waits for several events, is for a listen task',
      ],
      [
        '/schedule/on/until: A trigger matches every event of its brain while its version is active, so it takes no until',
      ],
      [
        '/schedule/on/one/with/data: A trigger is matched before any run starts, so its data expression cannot use variables such as $workflow',
      ],
    ]);
  });
});

describe('the trigger of a saved workflow', () => {
  it('is read from its schedule: the filters of its events, its cron or its period', () => {
    expect([
      triggerOfDocument({ schedule: { on: { any: [typed, { with: {} }] } } }),
      triggerOfDocument({ schedule: { cron: '0 9 * * *' } }),
      triggerOfDocument({ schedule: { every: 'PT5M' } }),
    ]).toEqual([
      {
        kind: 'events',
        filters: [
          {
            reference: '/schedule/on/any/0',
            type: 'com.acme.closed',
            attributes: { type: 'com.acme.closed' },
            dataNeedsVariables: false,
          },
        ],
      },
      { kind: 'cron', expression: '0 9 * * *' },
      { kind: 'every', milliseconds: 300_000 },
    ]);
  });

  it('is none for a workflow without a schedule that names one, or a source that is no workflow', () => {
    expect([
      triggerOfDocument({ do: [] }),
      triggerOfDocument({ schedule: { after: 'PT1M' } }),
      triggerOfSource('schedule: { on: { one: { with: { type: com.acme.closed } } } }'),
      triggerOfSource('schedule: ['),
    ]).toEqual([
      undefined,
      undefined,
      {
        kind: 'events',
        filters: [
          {
            reference: '/schedule/on/one',
            type: 'com.acme.closed',
            attributes: { type: 'com.acme.closed' },
            dataNeedsVariables: false,
          },
        ],
      },
      undefined,
    ]);
  });
});
