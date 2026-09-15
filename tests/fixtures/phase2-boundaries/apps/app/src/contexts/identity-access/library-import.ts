// PROHIBITED: a bounded context naming the authentication library directly.
// The instance is private to the adapter that holds the Prisma client.
import { betterAuth } from 'better-auth';

export function build(): unknown {
  return betterAuth;
}
