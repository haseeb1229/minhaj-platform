// FIXTURE — MUST FAIL. Review bypass: the class string passed to a helper.
declare function clsx(...parts: unknown[]): string;

export function ViaHelper({ active }: { readonly active: boolean }) {
  return <div className={clsx('pl-6', active && 'mr-2')}>helper argument</div>;
}
