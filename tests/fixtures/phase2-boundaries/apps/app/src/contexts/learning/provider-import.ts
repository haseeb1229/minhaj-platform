// The same prohibition, from a context that has nothing to do with Identity.
// A rule that only bound the context which happens to send mail today would
// be no rule at all.
import { Resend } from 'resend';

export function notify(): unknown {
  return Resend;
}
