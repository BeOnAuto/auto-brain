import { startScheduler, wallClock, type FiringMode } from './scheduler.ts';
import { openTimerStore, type TimerStore } from './timer-store.ts';

const [
  fileName = '',
  by = 'p',
  modeText = 'claim-then-fire',
  runForText = '10000',
  busyText = '5000',
  locking = 'NORMAL',
] = process.argv.slice(2);
const mode: FiringMode = modeText === 'naive' || modeText === 'fire-then-mark' ? modeText : 'claim-then-fire';
let firstError = '';
let store: TimerStore;
const startedAt = wallClock();
try {
  store = openTimerStore(fileName, {
    busyTimeoutMs: Number(busyText),
    lockingMode: locking === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'NORMAL',
  });
  store.earliest();
} catch (error) {
  console.log(
    JSON.stringify({ by, opened: false, error: String(error), afterMs: Math.round(wallClock() - startedAt) }),
  );
  process.exit(1);
}
const scheduler = startScheduler({
  store,
  by,
  mode,
  fire: (timer, lateMs) => {
    store.recordEffect(timer.id, wallClock(), by, lateMs);
  },
  onError: (error) => {
    firstError ||= String(error);
  },
});
console.log(JSON.stringify({ by, opened: true }));
setTimeout(() => {
  scheduler.stop();
  console.log(JSON.stringify({ by, ...scheduler.stats(), firstError }));
  store.close();
}, Number(runForText));
