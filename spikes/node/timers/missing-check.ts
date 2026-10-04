import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { dataDirectory } from './timer-plan.ts';

const database = new DatabaseSync(join(dataDirectory, 'two-schedulers-conditional-claim-no-busy-timeout', 'timers.db'));
const missing = database
  .prepare(
    'SELECT id, fire_at, cancelled, fired_at, fired_by FROM timers WHERE id NOT IN (SELECT timer_id FROM timer_effects)',
  )
  .all();
console.log(JSON.stringify(missing));
database.close();
