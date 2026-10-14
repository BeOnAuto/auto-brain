import { isRefusal, type Authentication, type Principal } from '../access/principal.ts';

export function principalIn(authentication: Authentication): Principal | undefined {
  return isRefusal(authentication) ? undefined : authentication;
}
