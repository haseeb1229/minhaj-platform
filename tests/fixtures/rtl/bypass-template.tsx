// FIXTURE — MUST FAIL. Review bypass: template literal static text.
export function ViaTemplate({ extra }: { readonly extra: string }) {
  return <div className={`ml-4 ${extra}`}>template literal</div>;
}
