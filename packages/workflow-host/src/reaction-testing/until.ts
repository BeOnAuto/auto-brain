import { setTimeout } from 'node:timers/promises';

export async function until<A>(read: () => Promise<A>, done: (value: A) => boolean): Promise<A> {
  const value = await read();
  if (done(value)) {
    return value;
  }
  await setTimeout(10);
  return until(read, done);
}
