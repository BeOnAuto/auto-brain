import { describe } from 'vitest';

import { failureSuite } from '../testing/failure-suite.ts';
import { onSQLite } from '../testing/host-files.ts';
import { leaseSuite } from '../testing/lease-suite.ts';
import { longRunSuite } from '../testing/long-run-suite.ts';
import { portSuite } from '../testing/port-suite.ts';
import { runSuite } from '../testing/run-suite.ts';

describe('the host on SQLite', () => {
  describe('its ports', () => {
    portSuite(onSQLite);
  });

  describe('a workflow it runs', () => {
    runSuite(onSQLite);
  });

  describe('a long run', () => {
    longRunSuite(onSQLite);
  });

  describe('killed while it dispatches, then started again', () => {
    failureSuite(onSQLite);
  });

  describe('one of two hosts on one database', () => {
    leaseSuite(onSQLite);
  });
});
