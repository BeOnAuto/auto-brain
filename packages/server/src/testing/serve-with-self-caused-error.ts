import { defaultServerOptions, runServer } from '../lifecycle.ts';

const selfCaused = new Error('an error whose cause is itself');
selfCaused.cause = selfCaused;

await runServer(process, {
  ...defaultServerOptions,
  routes: () => [
    (routes) => {
      routes.add('GET', '/self-caused', () => {
        throw selfCaused;
      });
    },
  ],
});
