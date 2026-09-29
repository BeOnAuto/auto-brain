import { Container } from '@cloudflare/containers';

export class BrainContainer extends Container {
  override defaultPort = 8080;
  override sleepAfter = '10m';
}
