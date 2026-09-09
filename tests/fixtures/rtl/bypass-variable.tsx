// FIXTURE — MUST FAIL. Review bypass: the class string lifted into a variable.
const layout = 'ml-4 pr-2';

export function ViaVariable() {
  return <div className={layout}>hoisted out of the attribute</div>;
}
