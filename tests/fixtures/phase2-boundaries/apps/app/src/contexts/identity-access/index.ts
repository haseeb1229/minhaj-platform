/** The context's public interface. Nothing here reaches infrastructure. */
export function describeAccount(id: string): string {
  return `account:${id}`;
}
