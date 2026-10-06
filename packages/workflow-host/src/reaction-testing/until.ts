import { setTimeout } from 'node:timers/promises';

export async function until<A>(read: () => Promise<A>, done: (value: A) => boolean, attempts = 400): Promise<A> {
  const value = await read();
  if (done(value) || attempts <= 1) {
    return value;
  }
  await setTimeout(10);
  return until(read, done, attempts - 1);
}
