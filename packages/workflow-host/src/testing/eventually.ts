import { setTimeout } from 'node:timers/promises';

export async function eventually<A>(read: () => A, done: (value: A) => boolean, attempts = 400): Promise<A> {
  const value = read();
  if (done(value) || attempts <= 1) {
    return value;
  }
  await setTimeout(10);
  return eventually(read, done, attempts - 1);
}
